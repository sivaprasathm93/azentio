package com.meridian.sentinel.alert;

import com.meridian.sentinel.customer.RiskRating;
import com.meridian.sentinel.detection.RiskScorer;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.config.ActiveRule;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Pure merge logic for folding rule hits into an alert (new or existing). Kept free of I/O so the de-duplication
 * semantics are unit-testable:
 * <ul>
 *   <li>one entry per rule code: severity is the max seen, hit count accumulates, the latest explanation wins
 *       (it describes the most complete picture of the pattern);</li>
 *   <li>the evidence window only ever widens;</li>
 *   <li>the score is recomputed from all contributing rules with current weights.</li>
 * </ul>
 */
public final class AlertAggregator {

    private AlertAggregator() {
    }

    public static void apply(Alert alert, String txnRef, List<RuleHit> hits, Map<String, ActiveRule> rules,
                             RiskRating customerRisk, Instant evidenceStart, Instant evidenceEnd) {
        Map<String, RuleDetail> details = new LinkedHashMap<>(alert.getRuleDetails() == null ? Map.of() : alert.getRuleDetails());
        for (RuleHit hit : hits) {
            ActiveRule rule = rules.get(hit.ruleCode());
            int version = rule == null ? 0 : rule.version();
            int weight = rule == null ? 0 : rule.weight();
            RuleDetail prev = details.get(hit.ruleCode());
            RuleDetail next = prev == null
                    ? new RuleDetail(hit.severity(), 1, version, weight, hit.explanation(), txnRef)
                    : new RuleDetail(Math.max(prev.severity(), hit.severity()), prev.hits() + 1, version, weight,
                    hit.explanation(), txnRef);
            details.put(hit.ruleCode(), next);
        }
        alert.setRuleDetails(details);
        alert.setRuleCodes(details.keySet().stream().sorted().toArray(String[]::new));
        alert.setHitCount(alert.getHitCount() + hits.size());

        Map<String, Double> severities = details.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().severity()));
        Map<String, Integer> weights = details.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().weight()));
        alert.setRiskScore(RiskScorer.score(severities, weights, customerRisk));
        alert.setExplanation(explain(details));

        if (evidenceStart != null && (alert.getWindowStart() == null || evidenceStart.isBefore(alert.getWindowStart()))) {
            alert.setWindowStart(evidenceStart);
        }
        if (evidenceEnd != null && (alert.getWindowEnd() == null || evidenceEnd.isAfter(alert.getWindowEnd()))) {
            alert.setWindowEnd(evidenceEnd);
        }
    }

    /** Rules ordered by contribution (weight x severity), one line each. */
    static String explain(Map<String, RuleDetail> details) {
        return details.entrySet().stream()
                .sorted(Comparator.comparingDouble((Map.Entry<String, RuleDetail> e) -> e.getValue().weight() * e.getValue().severity())
                        .reversed())
                .map(e -> "[" + e.getKey() + "] " + e.getValue().explanation())
                .collect(Collectors.joining("\n"));
    }
}
