package com.meridian.sentinel.detection;

import com.meridian.sentinel.config.SentinelProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * Parallel detection for bulk loads. Work is partitioned by customer: each customer's transactions are evaluated
 * sequentially in time order by one task (so behavioural and windowed rules see a consistent history), while
 * different customers run concurrently on the bounded detection pool.
 */
@Component
public class BulkDetectionRunner {

    private static final Logger log = LoggerFactory.getLogger(BulkDetectionRunner.class);

    private final DetectionService detectionService;
    private final ExecutorService executor;
    private final JdbcTemplate jdbc;
    private final int redriveAfterMinutes;
    private final AtomicBoolean redriving = new AtomicBoolean();

    public BulkDetectionRunner(DetectionService detectionService, ExecutorService detectionExecutor, JdbcTemplate jdbc,
                               SentinelProperties props) {
        this.detectionService = detectionService;
        this.executor = detectionExecutor;
        this.jdbc = jdbc;
        this.redriveAfterMinutes = props.guardrails().redriveAfterMinutes();
    }

    public record TxnKey(long id, long customerId, Instant occurredAt) {
    }

    public record Summary(int evaluated, int skipped, int transactionsWithHits, int alertsCreated, int alertsUpdated,
                          int failures, long elapsedMs, double txnPerSecond) {
    }

    public Summary run(List<TxnKey> txns) {
        long start = System.currentTimeMillis();
        Map<Long, List<TxnKey>> byCustomer = txns.stream().collect(Collectors.groupingBy(TxnKey::customerId,
                LinkedHashMap::new, Collectors.toList()));

        AtomicInteger evaluated = new AtomicInteger();
        AtomicInteger skipped = new AtomicInteger();
        AtomicInteger withHits = new AtomicInteger();
        AtomicInteger failures = new AtomicInteger();
        Set<Long> created = ConcurrentHashMap.newKeySet();
        Set<Long> touched = ConcurrentHashMap.newKeySet();

        List<CompletableFuture<Void>> futures = new ArrayList<>();
        for (List<TxnKey> customerTxns : byCustomer.values()) {
            futures.add(CompletableFuture.runAsync(() -> {
                customerTxns.sort(Comparator.comparing(TxnKey::occurredAt).thenComparingLong(TxnKey::id));
                for (TxnKey key : customerTxns) {
                    try {
                        DetectionService.Outcome o = detectionService.detect(key.id());
                        if (o.skipped()) {
                            skipped.incrementAndGet();
                            continue;
                        }
                        evaluated.incrementAndGet();
                        if (o.alertId() != null) {
                            withHits.incrementAndGet();
                            touched.add(o.alertId());
                            if (o.alertCreated()) {
                                created.add(o.alertId());
                            }
                        }
                    } catch (RuntimeException e) {
                        // Transaction stays unevaluated and is picked up by /detection/run-pending.
                        failures.incrementAndGet();
                        log.error("Detection failed for transaction id {}", key.id(), e);
                    }
                }
            }, executor));
        }
        CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).join();

        long elapsed = Math.max(1, System.currentTimeMillis() - start);
        touched.removeAll(created);
        Summary s = new Summary(evaluated.get(), skipped.get(), withHits.get(), created.size(), touched.size(),
                failures.get(), elapsed, Math.round(evaluated.get() * 1000.0 / elapsed * 10) / 10.0);
        log.info("Bulk detection: {} customers, {}", byCustomer.size(), s);
        return s;
    }

    /**
     * Guardrail (self-healing): no transaction may stay unmonitored. Anything still unevaluated some minutes after
     * ingestion (crash mid-batch, degraded rule, DB blip) is re-evaluated automatically.
     */
    @Scheduled(fixedDelayString = "${sentinel.guardrails.redrive-check-ms:60000}", initialDelayString = "60000")
    public void redriveStale() {
        if (!redriving.compareAndSet(false, true)) {
            return;
        }
        try {
            List<TxnKey> stale = jdbc.query("""
                    SELECT id, customer_id, occurred_at FROM bank_transaction
                    WHERE evaluated_at IS NULL AND ingested_at < now() - make_interval(mins => ?)
                    ORDER BY occurred_at, id LIMIT 20000""",
                    (rs, i) -> new TxnKey(rs.getLong(1), rs.getLong(2), rs.getObject(3, OffsetDateTime.class).toInstant()),
                    redriveAfterMinutes);
            if (!stale.isEmpty()) {
                log.warn("GUARDRAIL re-driving {} transaction(s) left unevaluated for > {} min", stale.size(), redriveAfterMinutes);
                run(stale);
            }
        } finally {
            redriving.set(false);
        }
    }

    /** Re-drives every transaction that has not been evaluated yet (recovery after a failure or restart). */
    public Summary runPending() {
        List<TxnKey> pending = jdbc.query(
                "SELECT id, customer_id, occurred_at FROM bank_transaction WHERE evaluated_at IS NULL ORDER BY occurred_at, id",
                (rs, i) -> new TxnKey(rs.getLong(1), rs.getLong(2), rs.getObject(3, OffsetDateTime.class).toInstant()));
        return run(pending);
    }
}
