package com.meridian.sentinel.alert;

import com.meridian.sentinel.customer.RiskRating;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.config.ActiveRule;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AlertAggregatorTest {

    private static final Instant T = Instant.parse("2026-06-15T04:30:00Z");

    @SuppressWarnings("unchecked")
    private static ActiveRule rule(String code, int weight, int version) {
        DetectionRule<Object> r = mock(DetectionRule.class);
        when(r.code()).thenReturn(code);
        return new ActiveRule(r, new Object(), true, weight, version);
    }

    private final Map<String, ActiveRule> rules = Map.of(
            "STRUCTURING", rule("STRUCTURING", 45, 3),
            "ROUND_AMOUNT", rule("ROUND_AMOUNT", 20, 1));

    @Test
    void repeatedHitsOfTheSamePatternFoldIntoOneRuleEntry() {
        Alert alert = new Alert();
        AlertAggregator.apply(alert, "T3", List.of(new RuleHit("STRUCTURING", 0.7, List.of(1L, 2L, 3L), "3 deposits")),
                rules, RiskRating.LOW, T, T.plusSeconds(3600));
        AlertAggregator.apply(alert, "T4", List.of(new RuleHit("STRUCTURING", 0.8, List.of(1L, 2L, 3L, 4L), "4 deposits")),
                rules, RiskRating.LOW, T, T.plusSeconds(7200));

        assertThat(alert.getRuleCodes()).containsExactly("STRUCTURING");
        RuleDetail d = alert.getRuleDetails().get("STRUCTURING");
        assertThat(d.hits()).isEqualTo(2);
        assertThat(d.severity()).isEqualTo(0.8);
        assertThat(d.explanation()).isEqualTo("4 deposits");
        assertThat(d.ruleVersion()).isEqualTo(3);
        assertThat(alert.getHitCount()).isEqualTo(2);
        assertThat(alert.getRiskScore()).isEqualTo(36);
        assertThat(alert.getWindowEnd()).isEqualTo(T.plusSeconds(7200));
    }

    @Test
    void severityNeverDecreasesAndWindowOnlyWidens() {
        Alert alert = new Alert();
        AlertAggregator.apply(alert, "T1", List.of(new RuleHit("STRUCTURING", 0.9, List.of(1L), "x")),
                rules, RiskRating.LOW, T, T.plusSeconds(100));
        AlertAggregator.apply(alert, "T2", List.of(new RuleHit("STRUCTURING", 0.7, List.of(2L), "y")),
                rules, RiskRating.LOW, T.plusSeconds(10), T.plusSeconds(50));

        assertThat(alert.getRuleDetails().get("STRUCTURING").severity()).isEqualTo(0.9);
        assertThat(alert.getWindowStart()).isEqualTo(T);
        assertThat(alert.getWindowEnd()).isEqualTo(T.plusSeconds(100));
    }

    @Test
    void differentRulesCombineIntoOneAlertWithCorroborationBonusAndOrderedExplanation() {
        Alert alert = new Alert();
        AlertAggregator.apply(alert, "T1", List.of(
                        new RuleHit("ROUND_AMOUNT", 0.5, List.of(1L), "round"),
                        new RuleHit("STRUCTURING", 0.7, List.of(1L, 2L, 3L), "structured")),
                rules, RiskRating.HIGH, T, T);

        assertThat(alert.getRuleCodes()).containsExactly("ROUND_AMOUNT", "STRUCTURING");
        // 45*0.7 + 20*0.5 + 10 (2 rules) + 15 (HIGH KYC) = 66.5 -> 67 (rounded half up)
        assertThat(alert.getRiskScore()).isEqualTo(67);
        assertThat(alert.getExplanation()).isEqualTo("[STRUCTURING] structured\n[ROUND_AMOUNT] round");
    }
}
