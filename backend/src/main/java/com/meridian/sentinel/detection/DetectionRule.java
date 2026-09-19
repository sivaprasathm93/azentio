package com.meridian.sentinel.detection;

import java.util.Optional;

/**
 * An AML typology. Implementations are stateless Spring beans; their tunable parameters live in the
 * {@code rule_config} table and are bound to {@link #paramsType()} (a validated record) at runtime.
 */
public interface DetectionRule<P> {

    String code();

    Class<P> paramsType();

    Optional<RuleHit> evaluate(RuleContext ctx, P params);
}
