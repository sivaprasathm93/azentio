package com.meridian.sentinel.alert;

import com.meridian.sentinel.customer.CustomerView;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class AlertViews {

    private AlertViews() {
    }

    public record AlertSummary(long id, String alertRef, long customerId, String customerRef, String customerName,
                               String customerRiskRating, String status, int riskScore, String riskBand,
                               List<String> ruleCodes, int hitCount, Instant windowStart, Instant windowEnd,
                               String assignee, Long caseId, Instant createdAt, Instant updatedAt) {
    }

    public record EvidenceTxn(long transactionId, String txnRef, String accountNumber, String direction,
                              BigDecimal amount, String currency, BigDecimal amountBase, String counterpartyName,
                              String counterpartyCountry, String channel, String jurisdiction, Instant occurredAt,
                              List<String> ruleCodes) {
    }

    public record AlertDetail(AlertSummary summary, String explanation, Map<String, RuleDetail> ruleDetails,
                              String disposition, String dispositionReason, String disposedBy, Instant disposedAt,
                              String caseRef, CustomerView customer, List<EvidenceTxn> evidence) {
    }
}
