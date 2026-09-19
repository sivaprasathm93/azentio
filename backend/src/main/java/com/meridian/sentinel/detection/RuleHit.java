package com.meridian.sentinel.detection;

import java.util.List;

/**
 * Output of a rule that fired.
 *
 * @param severity        0..1, how strongly the pattern is expressed; combined with the rule weight by {@link RiskScorer}
 * @param evidenceTxnIds  transactions that together constitute the pattern
 * @param explanation     analyst-facing sentence stating the facts and the threshold that was crossed
 */
public record RuleHit(String ruleCode, double severity, List<Long> evidenceTxnIds, String explanation) {

    public RuleHit {
        severity = Math.max(0.0, Math.min(1.0, severity));
        evidenceTxnIds = List.copyOf(evidenceTxnIds);
    }
}
