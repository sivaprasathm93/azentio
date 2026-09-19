package com.meridian.sentinel.detection.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.common.CurrentUser;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.ReferenceData;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Owns the runtime rule configuration. Rules are tuned through the API (thresholds, windows, weights, on/off);
 * changes are validated against each rule's typed params record, versioned, audited and hot-swapped into an
 * immutable in-memory snapshot, so detection threads never block on configuration reads. The snapshot is also
 * re-read periodically so several application instances converge without a redeploy.
 */
@Service
public class RuleConfigService {

    private static final Logger log = LoggerFactory.getLogger(RuleConfigService.class);

    private final RuleConfigRepository repository;
    private final RuleConfigHistoryRepository historyRepository;
    private final AuditService auditService;
    private final Validator validator;
    private final ObjectMapper strictMapper;
    private final Map<String, DetectionRule<Object>> rules;
    private final RuleGuardrails guardrails;
    private final ReferenceData reference;

    private volatile Map<String, ActiveRule> snapshot = Map.of();

    @SuppressWarnings("unchecked")
    public RuleConfigService(RuleConfigRepository repository, RuleConfigHistoryRepository historyRepository,
                             AuditService auditService, Validator validator, ObjectMapper mapper,
                             List<DetectionRule<?>> ruleBeans, RuleGuardrails guardrails, ReferenceData reference) {
        this.guardrails = guardrails;
        this.reference = reference;
        this.repository = repository;
        this.historyRepository = historyRepository;
        this.auditService = auditService;
        this.validator = validator;
        this.strictMapper = mapper.copy()
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
        this.rules = ruleBeans.stream()
                .map(r -> (DetectionRule<Object>) r)
                .collect(Collectors.toUnmodifiableMap(DetectionRule::code, Function.identity()));
    }

    /** Enabled rules in a stable order. */
    public List<ActiveRule> activeRules() {
        return snapshot.values().stream().filter(ActiveRule::enabled).toList();
    }

    public Map<String, ActiveRule> snapshot() {
        return snapshot;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(fixedDelayString = "${sentinel.rules.refresh-ms:30000}", initialDelayString = "${sentinel.rules.refresh-ms:30000}")
    public void refresh() {
        Map<String, ActiveRule> next = new LinkedHashMap<>();
        for (RuleConfig cfg : repository.findAllByOrderByRuleCode()) {
            DetectionRule<Object> rule = rules.get(cfg.getRuleCode());
            if (rule == null) {
                log.warn("rule_config '{}' has no matching rule implementation; ignored", cfg.getRuleCode());
                continue;
            }
            try {
                Object params = bind(rule, cfg.getParams());
                boolean enabled = cfg.isEnabled();
                List<String> violations = guardrails.violations(cfg.getRuleCode(), enabled, cfg.getWeight(), params, reference);
                if (!violations.isEmpty()) {
                    // Only reachable if the table was edited outside the API. Fail safe: mandated rules keep running.
                    log.error("GUARDRAIL rule_config '{}' v{} violates regulatory floors: {}", cfg.getRuleCode(),
                            cfg.getVersion(), violations);
                    if (RuleGuardrails.MANDATORY.contains(cfg.getRuleCode())) {
                        enabled = true;
                    }
                }
                next.put(cfg.getRuleCode(), new ActiveRule(rule, params, enabled, cfg.getWeight(), cfg.getVersion()));
            } catch (ApiException e) {
                log.error("rule_config '{}' v{} has invalid params ({}); rule disabled until fixed",
                        cfg.getRuleCode(), cfg.getVersion(), e.getMessage());
            }
        }
        rules.keySet().stream().filter(code -> !next.containsKey(code))
                .forEach(code -> log.warn("Rule {} has no valid configuration row and will not run", code));
        Map<String, ActiveRule> previous = snapshot;
        snapshot = Map.copyOf(next);
        if (!summary(previous).equals(summary(snapshot))) {
            log.info("Rule configuration loaded: {}", summary(snapshot));
        }
    }

    public List<RuleConfig> findAll() {
        return repository.findAllByOrderByRuleCode();
    }

    public RuleConfig get(String code) {
        return repository.findById(code).orElseThrow(() -> ApiException.notFound("Rule", code));
    }

    public List<RuleConfigHistory> history(String code) {
        get(code);
        return historyRepository.findByRuleCodeOrderByVersionDesc(code);
    }

    /**
     * Applies a partial update. {@code params} are merged over the current params, then the whole set is
     * validated against the rule's typed params before anything is persisted.
     */
    @Transactional
    public RuleConfig update(String code, Boolean enabled, Integer weight, Map<String, Object> paramChanges) {
        RuleConfig cfg = get(code);
        DetectionRule<Object> rule = rules.get(code);
        if (rule == null) {
            throw ApiException.unprocessable("RULE_NOT_IMPLEMENTED", "No detection logic is registered for rule " + code);
        }
        Map<String, Object> before = Map.of("enabled", cfg.isEnabled(), "weight", cfg.getWeight(),
                "params", cfg.getParams(), "version", cfg.getVersion());

        Map<String, Object> merged = new LinkedHashMap<>(cfg.getParams());
        if (paramChanges != null) {
            merged.putAll(paramChanges);
        }
        Object typed = bind(rule, merged); // throws 422 with details if invalid
        if (weight != null && (weight < 0 || weight > 100)) {
            throw ApiException.unprocessable("INVALID_WEIGHT", "weight must be between 0 and 100");
        }
        boolean newEnabled = enabled != null ? enabled : cfg.isEnabled();
        int newWeight = weight != null ? weight : cfg.getWeight();
        List<String> violations = guardrails.violations(code, newEnabled, newWeight, typed, reference);
        if (!violations.isEmpty()) {
            log.warn("Rejected rule change on {} by {}: {}", code, CurrentUser.name(), violations);
            throw ApiException.unprocessable("GUARDRAIL_VIOLATION", String.join("; ", violations));
        }

        if (enabled != null) {
            cfg.setEnabled(enabled);
        }
        if (weight != null) {
            cfg.setWeight(weight);
        }
        cfg.setParams(merged);
        cfg.setVersion(cfg.getVersion() + 1);
        cfg.setUpdatedBy(CurrentUser.name());
        cfg.setUpdatedAt(Instant.now());
        repository.save(cfg);

        RuleConfigHistory h = new RuleConfigHistory();
        h.setRuleCode(code);
        h.setVersion(cfg.getVersion());
        h.setEnabled(cfg.isEnabled());
        h.setWeight(cfg.getWeight());
        h.setParams(merged);
        h.setChangedBy(cfg.getUpdatedBy());
        h.setChangedAt(cfg.getUpdatedAt());
        historyRepository.save(h);

        auditService.record("RULE", code, "RULE_CONFIG_UPDATED", "v" + (cfg.getVersion() - 1), "v" + cfg.getVersion(),
                Map.of("before", before, "after", Map.of("enabled", cfg.isEnabled(), "weight", cfg.getWeight(), "params", merged)));

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                refresh();
            }
        });
        return cfg;
    }

    private Object bind(DetectionRule<Object> rule, Map<String, Object> params) {
        Object typed;
        try {
            typed = strictMapper.convertValue(params, rule.paramsType());
        } catch (IllegalArgumentException e) {
            String msg = e.getMessage() == null ? "invalid params" : e.getMessage().split("\n")[0];
            throw ApiException.unprocessable("INVALID_RULE_PARAMS", rule.code() + ": " + msg);
        }
        Set<ConstraintViolation<Object>> violations = validator.validate(typed);
        if (!violations.isEmpty()) {
            String msg = violations.stream().map(v -> v.getPropertyPath() + " " + v.getMessage())
                    .sorted().collect(Collectors.joining("; "));
            throw ApiException.unprocessable("INVALID_RULE_PARAMS", rule.code() + ": " + msg);
        }
        return typed;
    }

    private static String summary(Map<String, ActiveRule> s) {
        return s.values().stream()
                .map(r -> r.code() + "(v" + r.version() + (r.enabled() ? "" : ",off") + ",w" + r.weight() + ")")
                .sorted().collect(Collectors.joining(" "));
    }
}
