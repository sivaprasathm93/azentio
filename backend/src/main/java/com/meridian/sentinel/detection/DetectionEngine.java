package com.meridian.sentinel.detection;

import com.meridian.sentinel.detection.config.ActiveRule;
import com.meridian.sentinel.detection.config.RuleConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Runs every enabled rule against one transaction. A failing rule never blocks the others, but it is reported so
 * the caller can fail closed (hold the payment, keep the transaction pending for re-evaluation).
 */
@Component
public class DetectionEngine {

    private static final Logger log = LoggerFactory.getLogger(DetectionEngine.class);

    private final RuleConfigService ruleConfigService;

    public DetectionEngine(RuleConfigService ruleConfigService) {
        this.ruleConfigService = ruleConfigService;
    }

    public record Result(List<RuleHit> hits, List<String> failedRules) {

        public boolean degraded() {
            return !failedRules.isEmpty();
        }
    }

    public Result evaluate(RuleContext ctx) {
        List<RuleHit> hits = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        for (ActiveRule rule : ruleConfigService.activeRules()) {
            try {
                rule.evaluate(ctx).ifPresent(hits::add);
            } catch (RuntimeException e) {
                failed.add(rule.code());
                log.error("Rule {} failed on transaction {}; continuing with remaining rules",
                        rule.code(), ctx.txn().txnRef(), e);
            }
        }
        return new Result(hits, failed);
    }
}
