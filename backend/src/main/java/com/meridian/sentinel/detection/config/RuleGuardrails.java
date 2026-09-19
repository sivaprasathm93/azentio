package com.meridian.sentinel.detection.config;

import com.meridian.sentinel.detection.ReferenceData;
import com.meridian.sentinel.detection.rules.BehavioralDeviationRule;
import com.meridian.sentinel.detection.rules.CtrThresholdRule;
import com.meridian.sentinel.detection.rules.HighRiskJurisdictionRule;
import com.meridian.sentinel.detection.rules.RapidMovementRule;
import com.meridian.sentinel.detection.rules.StructuringRule;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Regulatory floors for runtime rule tuning. Admins may make rules <em>stricter</em> without a deployment, but never
 * looser than the bank's business rules, and never switch off a mandated typology. This closes the most expensive
 * failure mode of a configurable engine: a well-meant "noise reduction" change that silently stops detecting
 * laundering (regulatory fines, lost ability to freeze funds).
 * <p>
 * The floors are code, not configuration, on purpose: the person who can tune rules must not be able to move them.
 */
@Component
public class RuleGuardrails {

    /** Business Rules 1-5 are mandated; they can be tuned stricter but never disabled. */
    public static final Set<String> MANDATORY = Set.of(CtrThresholdRule.CODE, StructuringRule.CODE,
            RapidMovementRule.CODE, HighRiskJurisdictionRule.CODE, BehavioralDeviationRule.CODE);

    /** A mandated rule must keep enough weight to surface in the queue. */
    public static final int MIN_MANDATORY_WEIGHT = 10;

    static final BigDecimal CTR_MAX_USD = new BigDecimal("10000");          // BR1
    static final BigDecimal STRUCT_LOWER_MAX_USD = new BigDecimal("9000");  // BR2 band must cover 9,000-9,999
    static final BigDecimal STRUCT_UPPER_MIN_USD = new BigDecimal("9999");
    static final int STRUCT_MAX_COUNT = 3;
    static final int STRUCT_MIN_WINDOW_H = 24;
    static final BigDecimal RAPID_MAX_RATIO = new BigDecimal("0.80");        // BR3
    static final int RAPID_MIN_WINDOW_H = 48;
    static final BigDecimal BEHAV_MAX_MULTIPLIER = new BigDecimal("3.0");   // BR5

    /** Returns human-readable violations; empty means the configuration is at least as strict as mandated. */
    public List<String> violations(String code, boolean enabled, int weight, Object params, ReferenceData ref) {
        List<String> v = new ArrayList<>();
        if (!MANDATORY.contains(code)) {
            return v;
        }
        if (!enabled) {
            v.add(code + " is a mandated rule and cannot be disabled");
        }
        if (weight < MIN_MANDATORY_WEIGHT) {
            v.add(code + " weight must be at least " + MIN_MANDATORY_WEIGHT);
        }
        switch (params) {
            case CtrThresholdRule.Params p -> {
                if (ref.toBase(p.thresholdAmount(), p.thresholdCurrency()).compareTo(usd(ref, CTR_MAX_USD)) > 0) {
                    v.add("CTR threshold may not exceed USD 10,000 equivalent");
                }
            }
            case StructuringRule.Params p -> {
                if (ref.toBase(p.lowerAmount(), p.currency()).compareTo(usd(ref, STRUCT_LOWER_MAX_USD)) > 0) {
                    v.add("structuring band must start at or below USD 9,000 equivalent");
                }
                if (ref.toBase(p.upperAmount(), p.currency()).compareTo(usd(ref, STRUCT_UPPER_MIN_USD)) < 0) {
                    v.add("structuring band must extend to at least USD 9,999 equivalent");
                }
                if (p.minCount() > STRUCT_MAX_COUNT) {
                    v.add("structuring minCount may not exceed " + STRUCT_MAX_COUNT);
                }
                if (p.windowHours() < STRUCT_MIN_WINDOW_H) {
                    v.add("structuring window may not be shorter than " + STRUCT_MIN_WINDOW_H + "h");
                }
            }
            case RapidMovementRule.Params p -> {
                if (p.outflowRatio().compareTo(RAPID_MAX_RATIO) > 0) {
                    v.add("rapid-movement outflowRatio may not exceed 0.80");
                }
                if (p.windowHours() < RAPID_MIN_WINDOW_H) {
                    v.add("rapid-movement window may not be shorter than " + RAPID_MIN_WINDOW_H + "h");
                }
            }
            case HighRiskJurisdictionRule.Params p -> {
                if (!p.matchCounterpartyName()) {
                    v.add("sanctioned counterparty name matching may not be switched off");
                }
            }
            case BehavioralDeviationRule.Params p -> {
                if (p.multiplier().compareTo(BEHAV_MAX_MULTIPLIER) > 0) {
                    v.add("behavioural multiplier may not exceed 3.0x");
                }
            }
            default -> {
            }
        }
        return v;
    }

    private static BigDecimal usd(ReferenceData ref, BigDecimal amount) {
        return ref.toBase(amount, "USD");
    }
}
