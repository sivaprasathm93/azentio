package com.meridian.sentinel.detection;

import com.meridian.sentinel.detection.rules.HighRiskJurisdictionRule;

import java.util.ArrayList;
import java.util.List;

/**
 * Real-time verdict returned to the payment channel for each streamed transaction. This is the guardrail that turns
 * detection into loss prevention: money that has not left the bank can still be stopped.
 * <ul>
 *   <li><b>HOLD</b> – do not release/settle until an analyst reviews: sanctioned party or high-risk jurisdiction (either
 *       direction), an outgoing payment on a frozen account, an outgoing payment whose alert score is at or above the
 *       hold threshold, or a degraded evaluation (a rule failed) – <em>fail closed</em>.</li>
 *   <li><b>REVIEW</b> – settle, but an alert is in the analyst queue.</li>
 *   <li><b>ALLOW</b> – nothing fired.</li>
 * </ul>
 * A named sanctioned counterparty on an outgoing payment also freezes the account so follow-up debits are held.
 */
public final class PaymentDecisionPolicy {

    public enum Decision { ALLOW, REVIEW, HOLD }

    public record Result(Decision decision, List<String> reasons, boolean freezeAccount) {
    }

    private PaymentDecisionPolicy() {
    }

    public static Result decide(TxnView txn, String accountStatus, List<RuleHit> hits, Integer alertScore,
                                List<String> failedRules, int holdScore) {
        List<String> reasons = new ArrayList<>();
        boolean freeze = false;
        boolean outgoing = !txn.isCredit();

        if (!failedRules.isEmpty()) {
            reasons.add("evaluation degraded (" + String.join(", ", failedRules) + " failed); failing closed");
        }
        if (outgoing && "FROZEN".equals(accountStatus)) {
            reasons.add("account is frozen");
        }
        for (RuleHit h : hits) {
            if (HighRiskJurisdictionRule.CODE.equals(h.ruleCode())) {
                reasons.add("sanctions / high-risk jurisdiction match");
                if (outgoing && h.severity() >= HighRiskJurisdictionRule.SANCTIONED_PARTY_SEVERITY) {
                    freeze = true;
                }
            }
        }
        if (outgoing && alertScore != null && alertScore >= holdScore) {
            reasons.add("alert risk score " + alertScore + " >= hold threshold " + holdScore);
        }
        if (!reasons.isEmpty()) {
            return new Result(Decision.HOLD, reasons, freeze);
        }
        if (!hits.isEmpty()) {
            return new Result(Decision.REVIEW, List.of("alert raised: " + hits.stream().map(RuleHit::ruleCode).toList()), false);
        }
        return new Result(Decision.ALLOW, List.of(), false);
    }
}
