package com.meridian.sentinel.detection.config;

import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;

import java.util.Optional;

/** A rule bean bound to its current, already-validated parameters. Immutable snapshot. */
public record ActiveRule(DetectionRule<Object> rule, Object params, boolean enabled, int weight, int version) {

    public String code() {
        return rule.code();
    }

    public Optional<RuleHit> evaluate(RuleContext ctx) {
        return rule.evaluate(ctx, params);
    }
}
