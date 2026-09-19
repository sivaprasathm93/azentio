package com.meridian.sentinel.detection;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Point-in-time view of history used by rules. Every query is evaluated "as of" the transaction being
 * examined: only transactions that happened at or before it are visible, which makes bulk (back-dated) loads
 * and live streaming produce the same result.
 */
public interface DetectionHistory {

    /** Transactions on the same account in {@code [asOf.occurredAt - lookback, asOf]}, oldest first, including {@code asOf}. */
    List<TxnView> accountHistory(TxnView asOf, Duration lookback);

    /** Transactions of the same customer (all accounts) from {@code from} up to and including {@code asOf}, oldest first. */
    List<TxnView> customerHistorySince(TxnView asOf, Instant from);

    /** Aggregate of a customer's activity in {@code [from, toExclusive)}. */
    Baseline customerBaseline(long customerId, Instant from, Instant toExclusive);

    record Baseline(java.math.BigDecimal totalBase, long txnCount, Instant firstTxnAt) {
    }
}
