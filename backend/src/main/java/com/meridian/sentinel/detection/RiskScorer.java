package com.meridian.sentinel.detection;

import com.meridian.sentinel.customer.RiskRating;

import java.util.Map;

/**
 * Business Rule 7: alert risk score 0–100 as a weighted combination of the rules that fired.
 *
 * <pre>
 *   score = sum(weight[rule] * severity[rule])        // weight 0–100 from rule_config, severity 0–1 from the rule
 *         + 10 * (distinct rules - 1)                  // corroboration: independent typologies agreeing
 *         + KYC uplift (HIGH +15, MEDIUM +5)
 *   clamped to [1, 100]
 * </pre>
 */
public final class RiskScorer {

    static final int MULTI_RULE_BONUS = 10;

    private RiskScorer() {
    }

    public static int score(Map<String, Double> severityByRule, Map<String, Integer> weights, RiskRating customerRisk) {
        if (severityByRule.isEmpty()) {
            return 0;
        }
        double raw = 0;
        for (Map.Entry<String, Double> e : severityByRule.entrySet()) {
            raw += weights.getOrDefault(e.getKey(), 0) * e.getValue();
        }
        raw += MULTI_RULE_BONUS * (severityByRule.size() - 1);
        raw += switch (customerRisk == null ? RiskRating.LOW : customerRisk) {
            case HIGH -> 15;
            case MEDIUM -> 5;
            case LOW -> 0;
        };
        return (int) Math.max(1, Math.min(100, Math.round(raw)));
    }

    public static String band(int score) {
        if (score >= 80) {
            return "CRITICAL";
        }
        if (score >= 60) {
            return "HIGH";
        }
        if (score >= 40) {
            return "MEDIUM";
        }
        return "LOW";
    }
}
