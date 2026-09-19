package com.meridian.sentinel.detection;

import java.math.BigDecimal;
import java.time.Instant;

/** Immutable snapshot of a transaction as seen by detection rules. {@code amountBase} is normalised to INR. */
public record TxnView(
        long id,
        String txnRef,
        long accountId,
        long customerId,
        Direction direction,
        BigDecimal amount,
        String currency,
        BigDecimal amountBase,
        String counterpartyName,
        String counterpartyCountry,
        String channel,
        String jurisdiction,
        Instant occurredAt) {

    public enum Direction {
        CREDIT, DEBIT
    }

    public boolean isCredit() {
        return direction == Direction.CREDIT;
    }
}
