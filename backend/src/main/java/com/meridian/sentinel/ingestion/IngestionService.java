package com.meridian.sentinel.ingestion;

import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.detection.BulkDetectionRunner;
import com.meridian.sentinel.detection.CustomerLock;
import com.meridian.sentinel.detection.DetectionService;
import com.meridian.sentinel.ingestion.IngestionResult.RowError;
import com.meridian.sentinel.ingestion.RowReader.Row;
import com.meridian.sentinel.reference.ReferenceDataService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * Bulk (JSON array / CSV) and streaming ingestion.
 * <ul>
 *   <li>Row-level validation: malformed or referentially invalid rows are rejected, persisted to
 *       {@code ingestion_error} and reported; valid rows in the same batch still load.</li>
 *   <li>Idempotent: customers/accounts upsert on their business key; transactions are insert-once on
 *       {@code txn_ref} and replays are reported as duplicates and never re-evaluated.</li>
 *   <li>Amounts are normalised to the base currency at ingestion using the configurable FX table.</li>
 * </ul>
 */
@Service
public class IngestionService {

    private static final Logger log = LoggerFactory.getLogger(IngestionService.class);
    private static final int CHUNK = 500;
    private static final int MAX_REPORTED_ERRORS = 200;
    private static final Duration MAX_CLOCK_SKEW = Duration.ofMinutes(5);

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final ReferenceDataService reference;
    private final BulkDetectionRunner bulkDetection;
    private final DetectionService detectionService;
    private final CustomerLock customerLock;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public IngestionService(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, ReferenceDataService reference,
                            BulkDetectionRunner bulkDetection, DetectionService detectionService,
                            CustomerLock customerLock, AuditService audit, PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.named = named;
        this.reference = reference;
        this.bulkDetection = bulkDetection;
        this.detectionService = detectionService;
        this.customerLock = customerLock;
        this.audit = audit;
        this.tx = new TransactionTemplate(txManager);
    }

    // ------------------------------------------------------------------ customers

    public IngestionResult ingestCustomers(List<Row<CustomerRecord>> rows, String source) {
        Batch<CustomerRecord> b = new Batch<>("CUSTOMER", rows, CustomerRecord::key);
        List<CustomerRecord> valid = b.valid();
        for (List<CustomerRecord> chunk : chunks(valid)) {
            jdbc.batchUpdate("""
                    INSERT INTO customer (external_ref, full_name, national_id, date_of_birth, customer_type, country, kyc_risk_rating)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (external_ref) DO UPDATE SET full_name = EXCLUDED.full_name, national_id = EXCLUDED.national_id,
                        date_of_birth = EXCLUDED.date_of_birth, customer_type = EXCLUDED.customer_type, country = EXCLUDED.country,
                        kyc_risk_rating = EXCLUDED.kyc_risk_rating, updated_at = now()""",
                    chunk.stream().map(c -> new Object[]{c.externalRef(), c.fullName(), c.nationalId(), c.dateOfBirth(),
                            c.customerType(), c.country(), c.kycRiskRating()}).toList());
        }
        return b.finish(valid.size(), 0, source, null);
    }

    // ------------------------------------------------------------------ accounts

    public IngestionResult ingestAccounts(List<Row<AccountRecord>> rows, String source) {
        Batch<AccountRecord> b = new Batch<>("ACCOUNT", rows, AccountRecord::key);
        Map<String, Long> customers = lookup("SELECT external_ref AS k, id AS v FROM customer WHERE external_ref IN (:keys)",
                b.valid().stream().map(AccountRecord::customerRef).toList());
        List<Object[]> args = new ArrayList<>();
        for (Row<AccountRecord> r : b.validRows()) {
            AccountRecord a = r.value();
            Long customerId = customers.get(a.customerRef());
            if (customerId == null) {
                b.reject(r, "customerRef '" + a.customerRef() + "' does not exist (load customers first)");
            } else if (!reference.isSupportedCurrency(a.currency())) {
                b.reject(r, "currency " + a.currency() + " has no configured exchange rate");
            } else {
                args.add(new Object[]{a.accountNumber(), customerId, a.accountType(), a.currency(), a.openedOn(),
                        a.riskRating(), a.status() == null ? "ACTIVE" : a.status()});
            }
        }
        for (List<Object[]> chunk : chunks(args)) {
            jdbc.batchUpdate("""
                    INSERT INTO account (account_number, customer_id, account_type, currency, opened_on, risk_rating, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (account_number) DO UPDATE SET account_type = EXCLUDED.account_type,
                        risk_rating = EXCLUDED.risk_rating, status = EXCLUDED.status
                    WHERE account.customer_id = EXCLUDED.customer_id""", chunk);
        }
        return b.finish(args.size(), 0, source, null);
    }

    // ------------------------------------------------------------------ transactions (bulk)

    public IngestionResult ingestTransactions(List<Row<TransactionRecord>> rows, String source, boolean detect) {
        Batch<TransactionRecord> b = new Batch<>("TRANSACTION", rows, TransactionRecord::key);
        Map<String, AccountRef> accounts = accountRefs(b.valid().stream().map(TransactionRecord::accountNumber).toList());

        List<Object[]> args = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Row<TransactionRecord> r : b.validRows()) {
            TransactionRecord t = r.value();
            String problem = check(t, accounts.get(t.accountNumber()));
            if (problem == null && !seen.add(t.txnRef())) {
                problem = "duplicate txnRef within batch";
            }
            if (problem != null) {
                b.reject(r, problem);
                continue;
            }
            args.add(insertArgs(t, accounts.get(t.accountNumber())));
        }

        List<BulkDetectionRunner.TxnKey> inserted = new ArrayList<>();
        for (List<Object[]> chunk : chunks(args)) {
            inserted.addAll(insertReturning(chunk));
        }
        int duplicates = args.size() - inserted.size();
        if (duplicates > 0) {
            log.info("Batch {}: {} transaction(s) already existed (idempotent replay) and were skipped", b.batchId, duplicates);
        }
        BulkDetectionRunner.Summary detection = detect && !inserted.isEmpty() ? bulkDetection.run(inserted) : null;
        return b.finish(inserted.size(), duplicates, source, detection);
    }

    // ------------------------------------------------------------------ transactions (streaming)

    public record StreamResult(long transactionId, String txnRef, BigDecimal amountBase, String baseCurrency,
                               DetectionService.Outcome detection, long latencyMs) {
    }

    /** Single transaction from a continuous feed: persisted and evaluated atomically, typically in a few ms. */
    @Transactional
    public StreamResult ingestOne(TransactionRecord t) {
        long start = System.nanoTime();
        AccountRef account = accountRefs(List.of(t.accountNumber())).get(t.accountNumber());
        String problem = check(t, account);
        if (problem != null) {
            throw ApiException.unprocessable("INVALID_TRANSACTION", problem);
        }
        customerLock.lock(account.customerId());
        List<BulkDetectionRunner.TxnKey> rows = insertReturning(List.<Object[]>of(insertArgs(t, account)));
        if (rows.isEmpty()) {
            throw ApiException.conflict("DUPLICATE_TRANSACTION", "Transaction " + t.txnRef() + " has already been ingested");
        }
        long id = rows.get(0).id();
        DetectionService.Outcome outcome = detectionService.detectInCurrentTransaction(id);
        return new StreamResult(id, t.txnRef(), reference.toBase(t.amount(), t.currency()), reference.baseCurrency(),
                outcome, (System.nanoTime() - start) / 1_000_000);
    }

    public List<Map<String, Object>> errors(UUID batchId) {
        return jdbc.queryForList("SELECT batch_id, record_type, line_no, record_key, error, raw, created_at "
                + "FROM ingestion_error WHERE batch_id = ? ORDER BY id", batchId);
    }

    public List<Map<String, Object>> recentBatches() {
        return jdbc.queryForList("""
                SELECT entity_id AS batch_id, actor, occurred_at, details FROM audit_log
                WHERE entity_type = 'INGESTION' ORDER BY id DESC LIMIT 50""");
    }

    // ------------------------------------------------------------------ helpers

    private record AccountRef(long accountId, long customerId, String status) {
    }

    private String check(TransactionRecord t, AccountRef account) {
        if (account == null) {
            return "accountNumber '" + t.accountNumber() + "' does not exist";
        }
        if ("CLOSED".equals(account.status())) {
            return "account " + t.accountNumber() + " is closed";
        }
        if (!reference.isSupportedCurrency(t.currency())) {
            return "currency " + t.currency() + " has no configured exchange rate";
        }
        if (t.occurredAt().isAfter(Instant.now().plus(MAX_CLOCK_SKEW))) {
            return "occurredAt is in the future";
        }
        return null;
    }

    private Object[] insertArgs(TransactionRecord t, AccountRef a) {
        return new Object[]{t.txnRef(), a.accountId(), a.customerId(), t.direction(), t.amount(), t.currency(),
                reference.toBase(t.amount(), t.currency()), t.counterpartyName(), t.counterpartyAccount(),
                t.counterpartyCountry(), t.channel(), t.jurisdiction(), OffsetDateTime.ofInstant(t.occurredAt(), ZoneOffset.UTC)};
    }

    /** One multi-row INSERT per chunk; RETURNING tells us exactly which rows were new (the rest were duplicates). */
    private List<BulkDetectionRunner.TxnKey> insertReturning(List<Object[]> chunk) {
        StringBuilder sql = new StringBuilder("INSERT INTO bank_transaction (txn_ref, account_id, customer_id, direction, amount, "
                + "currency, amount_base, counterparty_name, counterparty_account, counterparty_country, channel, jurisdiction, "
                + "occurred_at) VALUES ");
        List<Object> params = new ArrayList<>(chunk.size() * 13);
        for (int i = 0; i < chunk.size(); i++) {
            sql.append(i == 0 ? "" : ",").append("(?,?,?,?,?,?,?,?,?,?,?,?,?)");
            params.addAll(Arrays.asList(chunk.get(i))); // Arrays.asList tolerates the nullable columns
        }
        sql.append(" ON CONFLICT (txn_ref) DO NOTHING RETURNING id, customer_id, occurred_at");
        return jdbc.query(sql.toString(), (rs, n) -> new BulkDetectionRunner.TxnKey(rs.getLong(1), rs.getLong(2),
                rs.getObject(3, OffsetDateTime.class).toInstant()), params.toArray());
    }

    private Map<String, AccountRef> accountRefs(List<String> numbers) {
        Map<String, AccountRef> out = new HashMap<>();
        for (List<String> chunk : chunks(new ArrayList<>(new HashSet<>(numbers)))) {
            named.query("SELECT account_number, id, customer_id, status FROM account WHERE account_number IN (:keys)",
                    Map.of("keys", chunk), rs -> {
                        out.put(rs.getString(1), new AccountRef(rs.getLong(2), rs.getLong(3), rs.getString(4)));
                    });
        }
        return out;
    }

    private Map<String, Long> lookup(String sql, List<String> keys) {
        Map<String, Long> out = new HashMap<>();
        for (List<String> chunk : chunks(new ArrayList<>(new HashSet<>(keys)))) {
            named.query(sql, Map.of("keys", chunk), rs -> {
                out.put(rs.getString("k"), rs.getLong("v"));
            });
        }
        return out;
    }

    private static <T> List<List<T>> chunks(List<T> list) {
        List<List<T>> out = new ArrayList<>();
        for (int i = 0; i < list.size(); i += CHUNK) {
            out.add(list.subList(i, Math.min(list.size(), i + CHUNK)));
        }
        return out;
    }

    /** Tracks one batch: row-level rejections, error persistence and the audit entry. */
    private final class Batch<T> {
        final UUID batchId = UUID.randomUUID();
        final String type;
        final List<Row<T>> rows;
        final Function<T, String> keyFn;
        final Map<Row<T>, String> rejected = new LinkedHashMap<>();
        final long started = System.currentTimeMillis();

        Batch(String type, List<Row<T>> rows, Function<T, String> keyFn) {
            this.type = type;
            this.rows = rows;
            this.keyFn = keyFn;
            rows.stream().filter(r -> !r.ok()).forEach(r -> rejected.put(r, r.error()));
        }

        List<Row<T>> validRows() {
            return rows.stream().filter(r -> r.ok() && !rejected.containsKey(r)).toList();
        }

        List<T> valid() {
            return validRows().stream().map(Row::value).toList();
        }

        void reject(Row<T> row, String error) {
            rejected.put(row, error);
        }

        IngestionResult finish(int accepted, int duplicates, String source, BulkDetectionRunner.Summary detection) {
            List<RowError> errors = rejected.entrySet().stream()
                    .map(e -> new RowError(e.getKey().line(), e.getKey().value() == null ? null : keyFn.apply(e.getKey().value()),
                            e.getValue()))
                    .toList();
            if (!errors.isEmpty()) {
                List<Object[]> args = new ArrayList<>();
                rejected.forEach((row, err) -> args.add(new Object[]{batchId, type, row.line(),
                        row.value() == null ? null : keyFn.apply(row.value()), row.raw(), err}));
                jdbc.batchUpdate("INSERT INTO ingestion_error (batch_id, record_type, line_no, record_key, raw, error) "
                        + "VALUES (?, ?, ?, ?, ?, ?)", args);
                log.warn("Batch {} ({}): rejected {} of {} records, first error: line {} {}", batchId, type,
                        errors.size(), rows.size(), errors.get(0).line(), errors.get(0).error());
            }
            long ms = System.currentTimeMillis() - started;
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("recordType", type);
            details.put("source", source);
            details.put("received", rows.size());
            details.put("accepted", accepted);
            details.put("duplicates", duplicates);
            details.put("rejected", errors.size());
            if (detection != null) {
                details.put("alertsCreated", detection.alertsCreated());
                details.put("alertsUpdated", detection.alertsUpdated());
            }
            tx.executeWithoutResult(s -> audit.record("INGESTION", batchId, "BATCH_INGESTED", null, "COMPLETED", details));
            log.info("Batch {} ({}) from {}: received={} accepted={} duplicates={} rejected={} in {} ms",
                    batchId, type, source, rows.size(), accepted, duplicates, errors.size(), ms);
            boolean truncated = errors.size() > MAX_REPORTED_ERRORS;
            return new IngestionResult(batchId, type, rows.size(), accepted, duplicates, errors.size(),
                    truncated ? errors.subList(0, MAX_REPORTED_ERRORS) : errors, truncated, ms, detection);
        }
    }
}
