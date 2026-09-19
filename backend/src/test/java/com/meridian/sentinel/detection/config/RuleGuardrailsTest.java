package com.meridian.sentinel.detection.config;

import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.rules.BehavioralDeviationRule;
import com.meridian.sentinel.detection.rules.CtrThresholdRule;
import com.meridian.sentinel.detection.rules.HighRiskJurisdictionRule;
import com.meridian.sentinel.detection.rules.RapidMovementRule;
import com.meridian.sentinel.detection.rules.RoundAmountRule;
import com.meridian.sentinel.detection.rules.StructuringRule;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class RuleGuardrailsTest {

    private final RuleGuardrails g = new RuleGuardrails();
    private final Fixtures.Reference ref = new Fixtures.Reference();

    @Test
    void defaultsFromTheBusinessRulesPass() {
        assertThat(g.violations("CTR_THRESHOLD", true, 30,
                new CtrThresholdRule.Params(new BigDecimal("10000"), "USD"), ref)).isEmpty();
        assertThat(g.violations("STRUCTURING", true, 45, new StructuringRule.Params(new BigDecimal("9000"),
                new BigDecimal("9999.99"), "USD", 3, 24), ref)).isEmpty();
        assertThat(g.violations("RAPID_MOVEMENT", true, 40, new RapidMovementRule.Params(48, new BigDecimal("0.80"),
                new BigDecimal("5000"), "USD"), ref)).isEmpty();
    }

    @Test
    void ctrThresholdCannotBeRaisedAboveTenThousandDollarsInAnyCurrency() {
        assertThat(g.violations("CTR_THRESHOLD", true, 30, new CtrThresholdRule.Params(new BigDecimal("10001"), "USD"), ref))
                .anyMatch(v -> v.contains("USD 10,000"));
        // INR 900,000 > USD 10,000 (INR 835,000)
        assertThat(g.violations("CTR_THRESHOLD", true, 30, new CtrThresholdRule.Params(new BigDecimal("900000"), "INR"), ref))
                .isNotEmpty();
        // Stricter is always fine
        assertThat(g.violations("CTR_THRESHOLD", true, 30, new CtrThresholdRule.Params(new BigDecimal("5000"), "USD"), ref))
                .isEmpty();
    }

    @Test
    void looseningRapidMovementBehaviouralOrSanctionsIsRejected() {
        assertThat(g.violations("RAPID_MOVEMENT", true, 40, new RapidMovementRule.Params(24, new BigDecimal("0.95"),
                new BigDecimal("5000"), "USD"), ref)).hasSize(2);
        assertThat(g.violations("BEHAVIORAL_DEVIATION", true, 30, new BehavioralDeviationRule.Params(new BigDecimal("5"),
                90, 30, BigDecimal.ZERO, 10, "USD"), ref)).hasSize(1);
        assertThat(g.violations("HIGH_RISK_JURISDICTION", true, 60, new HighRiskJurisdictionRule.Params(false), ref))
                .hasSize(1);
    }

    @Test
    void optionalRulesAreFreelyTunable() {
        assertThat(g.violations("ROUND_AMOUNT", false, 0, new RoundAmountRule.Params(new BigDecimal("1000"),
                BigDecimal.ZERO, "USD", 10, 1), ref)).isEmpty();
    }
}
