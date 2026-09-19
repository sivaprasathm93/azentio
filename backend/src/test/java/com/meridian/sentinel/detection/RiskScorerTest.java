package com.meridian.sentinel.detection;

import com.meridian.sentinel.customer.RiskRating;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RiskScorerTest {

    private static final Map<String, Integer> WEIGHTS = Map.of(
            "CTR_THRESHOLD", 30, "STRUCTURING", 45, "HIGH_RISK_JURISDICTION", 60, "ROUND_AMOUNT", 20);

    @Test
    void singleRuleScoreIsWeightTimesSeverity() {
        assertThat(RiskScorer.score(Map.of("STRUCTURING", 0.8), WEIGHTS, RiskRating.LOW)).isEqualTo(36);
    }

    @Test
    void corroboratingRulesAddABonusSoTheyRankHigher() {
        int single = RiskScorer.score(Map.of("STRUCTURING", 0.7), WEIGHTS, RiskRating.LOW);
        int combined = RiskScorer.score(Map.of("STRUCTURING", 0.7, "ROUND_AMOUNT", 0.5), WEIGHTS, RiskRating.LOW);
        // 31.5 + 10 + 10 bonus
        assertThat(combined).isEqualTo(52).isGreaterThan(single);
    }

    @Test
    void kycRiskUpliftsTheScore() {
        Map<String, Double> sev = Map.of("CTR_THRESHOLD", 0.6);
        assertThat(RiskScorer.score(sev, WEIGHTS, RiskRating.LOW)).isEqualTo(18);
        assertThat(RiskScorer.score(sev, WEIGHTS, RiskRating.MEDIUM)).isEqualTo(23);
        assertThat(RiskScorer.score(sev, WEIGHTS, RiskRating.HIGH)).isEqualTo(33);
    }

    @Test
    void scoreIsClampedToOneHundred() {
        Map<String, Double> all = Map.of("CTR_THRESHOLD", 1.0, "STRUCTURING", 1.0, "HIGH_RISK_JURISDICTION", 1.0);
        assertThat(RiskScorer.score(all, WEIGHTS, RiskRating.HIGH)).isEqualTo(100);
    }

    @Test
    void disabledOrZeroWeightRulesStillYieldAtLeastOne() {
        assertThat(RiskScorer.score(Map.of("UNKNOWN", 1.0), WEIGHTS, RiskRating.LOW)).isEqualTo(1);
        assertThat(RiskScorer.score(Map.of(), WEIGHTS, RiskRating.LOW)).isZero();
    }

    @Test
    void bandsMatchQueueColouring() {
        assertThat(RiskScorer.band(85)).isEqualTo("CRITICAL");
        assertThat(RiskScorer.band(60)).isEqualTo("HIGH");
        assertThat(RiskScorer.band(40)).isEqualTo("MEDIUM");
        assertThat(RiskScorer.band(39)).isEqualTo("LOW");
    }
}
