package com.meridian.sentinel.customer;

import com.meridian.sentinel.account.Account;
import com.meridian.sentinel.account.AccountRepository;
import com.meridian.sentinel.common.PageResponse;
import com.meridian.sentinel.common.PiiMasker;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.sql.Array;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;

@RestController
@RequestMapping("/api/v1/customers")
@Tag(name = "Customers", description = "Customer lookup, accounts and transaction timeline")
@PreAuthorize("hasRole('ANALYST')")
public class CustomerController {

    private final NamedParameterJdbcTemplate jdbc;
    private final AccountRepository accounts;
    private final PiiAccessService piiAccess;

    public CustomerController(NamedParameterJdbcTemplate jdbc, AccountRepository accounts, PiiAccessService piiAccess) {
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.piiAccess = piiAccess;
    }

    public record CustomerSummary(long id, String externalRef, String fullName, String customerType, String country,
                                  String kycRiskRating, int accounts, int openAlerts, Integer maxOpenScore) {
    }

    public record TimelineTxn(long id, String txnRef, String accountNumber, String direction, BigDecimal amount,
                              String currency, BigDecimal amountBase, String counterpartyName, String counterpartyCountry,
                              String channel, Instant occurredAt, List<String> alertRefs) {
    }

    public record CustomerDetail(CustomerView customer, List<Account> accounts) {
    }

    @GetMapping
    @Operation(summary = "Customers (PII masked), optionally filtered by reference prefix or KYC risk")
    public PageResponse<CustomerSummary> list(@RequestParam(required = false) String q,
                                              @RequestParam(required = false) RiskRating riskRating,
                                              @RequestParam(defaultValue = "0") @Min(0) int page,
                                              @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        MapSqlParameterSource p = new MapSqlParameterSource();
        if (q != null && !q.isBlank()) {
            where.append(" AND (c.external_ref ILIKE :q OR EXISTS (SELECT 1 FROM account a WHERE a.customer_id = c.id AND a.account_number ILIKE :q))");
            p.addValue("q", q.trim() + "%");
        }
        if (riskRating != null) {
            where.append(" AND c.kyc_risk_rating = :risk");
            p.addValue("risk", riskRating.name());
        }
        long total = jdbc.queryForObject("SELECT COUNT(*) FROM customer c" + where, p, Long.class);
        p.addValue("limit", size).addValue("offset", (long) page * size);
        List<CustomerSummary> rows = jdbc.query("""
                SELECT c.id, c.external_ref, c.full_name, c.customer_type, c.country, c.kyc_risk_rating,
                       (SELECT COUNT(*) FROM account a WHERE a.customer_id = c.id) AS accounts,
                       (SELECT COUNT(*) FROM alert al WHERE al.customer_id = c.id AND al.status IN ('OPEN','UNDER_REVIEW','ESCALATED')) AS open_alerts,
                       (SELECT MAX(al.risk_score) FROM alert al WHERE al.customer_id = c.id AND al.status IN ('OPEN','UNDER_REVIEW','ESCALATED')) AS max_score
                FROM customer c""" + where + " ORDER BY open_alerts DESC, c.external_ref LIMIT :limit OFFSET :offset", p,
                (rs, i) -> new CustomerSummary(rs.getLong("id"), rs.getString("external_ref"),
                        PiiMasker.maskName(rs.getString("full_name")), rs.getString("customer_type"), rs.getString("country"),
                        rs.getString("kyc_risk_rating"), rs.getInt("accounts"), rs.getInt("open_alerts"),
                        (Integer) rs.getObject("max_score")));
        return PageResponse.of(rows, page, size, total);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Customer detail with accounts. Full PII only for SUPERVISOR/ADMIN (and audited)")
    public CustomerDetail get(@PathVariable long id) {
        return new CustomerDetail(piiAccess.detailView(id, "customer detail"), accounts.findByCustomerIdOrderByOpenedOn(id));
    }

    @GetMapping("/{id}/transactions")
    @Operation(summary = "Transaction timeline across all accounts, with the alerts each transaction is evidence for")
    public List<TimelineTxn> timeline(@PathVariable long id,
                                      @RequestParam(required = false) Instant from,
                                      @RequestParam(required = false) Instant to,
                                      @RequestParam(defaultValue = "1000") @Min(1) @Max(5000) int limit) {
        Instant end = to == null ? Instant.now() : to;
        Instant start = from == null ? end.minus(120, ChronoUnit.DAYS) : from;
        return jdbc.query("""
                        SELECT t.id, t.txn_ref, acc.account_number, t.direction, t.amount, t.currency, t.amount_base,
                               t.counterparty_name, t.counterparty_country, t.channel, t.occurred_at,
                               ARRAY(SELECT DISTINCT al.alert_ref FROM alert_evidence e JOIN alert al ON al.id = e.alert_id
                                     WHERE e.transaction_id = t.id) AS alert_refs
                        FROM bank_transaction t JOIN account acc ON acc.id = t.account_id
                        WHERE t.customer_id = :id AND t.occurred_at BETWEEN :from AND :to
                        ORDER BY t.occurred_at DESC LIMIT :limit""",
                new MapSqlParameterSource("id", id)
                        .addValue("from", OffsetDateTime.ofInstant(start, ZoneOffset.UTC))
                        .addValue("to", OffsetDateTime.ofInstant(end, ZoneOffset.UTC))
                        .addValue("limit", limit),
                (rs, i) -> {
                    Array refs = rs.getArray("alert_refs");
                    return new TimelineTxn(rs.getLong("id"), rs.getString("txn_ref"), rs.getString("account_number"),
                            rs.getString("direction"), rs.getBigDecimal("amount"), rs.getString("currency"),
                            rs.getBigDecimal("amount_base"), rs.getString("counterparty_name"),
                            rs.getString("counterparty_country"), rs.getString("channel"),
                            rs.getObject("occurred_at", OffsetDateTime.class).toInstant(),
                            refs == null ? List.of() : Arrays.asList((String[]) refs.getArray()));
                });
    }
}
