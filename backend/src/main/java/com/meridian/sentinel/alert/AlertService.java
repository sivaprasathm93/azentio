package com.meridian.sentinel.alert;

import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.common.CurrentUser;
import com.meridian.sentinel.common.Roles;
import com.meridian.sentinel.config.SentinelProperties;
import com.meridian.sentinel.customer.RiskRating;
import com.meridian.sentinel.detection.CustomerLock;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import com.meridian.sentinel.detection.config.RuleConfigService;
import com.meridian.sentinel.detection.rules.HighRiskJurisdictionRule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Array;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class AlertService {

    public static final String ENGINE_ACTOR = "detection-engine";
    private static final Logger log = LoggerFactory.getLogger(AlertService.class);

    private final AlertRepository repository;
    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final CustomerLock customerLock;
    private final RuleConfigService ruleConfigService;
    private final Duration aggregationWindow;
    private final int supervisorCloseScore;

    public AlertService(AlertRepository repository, JdbcTemplate jdbc, AuditService audit, CustomerLock customerLock,
                        RuleConfigService ruleConfigService, SentinelProperties props) {
        this.repository = repository;
        this.jdbc = jdbc;
        this.audit = audit;
        this.customerLock = customerLock;
        this.ruleConfigService = ruleConfigService;
        this.aggregationWindow = Duration.ofHours(props.detection().aggregationWindowHours());
        this.supervisorCloseScore = props.guardrails().supervisorCloseScore();
    }

    public record RaiseResult(Alert alert, boolean created) {
    }

    /**
     * Folds the hits for one transaction into the customer's current open alert (if its evidence window is within
     * the aggregation window) or opens a new one. Caller must hold the customer lock — this is what makes
     * "find candidate, then insert-or-update" race-free.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public RaiseResult raise(TxnView txn, List<RuleHit> hits, RiskRating customerRisk) {
        Set<Long> evidenceIds = new LinkedHashSet<>();
        hits.forEach(h -> evidenceIds.addAll(h.evidenceTxnIds()));
        Instant[] window = evidenceWindow(evidenceIds);

        List<Alert> candidates = repository.findAggregationCandidates(txn.customerId(),
                EnumSet.of(AlertStatus.OPEN, AlertStatus.UNDER_REVIEW),
                txn.occurredAt().minus(aggregationWindow), txn.occurredAt().plus(aggregationWindow));

        boolean created = candidates.isEmpty();
        Alert alert;
        int scoreBefore = 0;
        if (created) {
            alert = new Alert();
            alert.setAlertRef("ALT-" + jdbc.queryForObject("SELECT nextval('alert_ref_seq')", Long.class));
            alert.setCustomerId(txn.customerId());
            alert.setStatus(AlertStatus.OPEN);
            alert.setCreatedAt(Instant.now());
        } else {
            alert = candidates.get(0);
            scoreBefore = alert.getRiskScore();
        }
        AlertAggregator.apply(alert, txn.txnRef(), hits, ruleConfigService.snapshot(), customerRisk, window[0], window[1]);
        alert.setUpdatedAt(Instant.now());
        alert = repository.saveAndFlush(alert);

        List<Object[]> rows = new ArrayList<>();
        for (RuleHit hit : hits) {
            for (Long id : hit.evidenceTxnIds()) {
                rows.add(new Object[]{alert.getId(), id, hit.ruleCode()});
            }
        }
        jdbc.batchUpdate("INSERT INTO alert_evidence (alert_id, transaction_id, rule_code) VALUES (?, ?, ?) "
                + "ON CONFLICT DO NOTHING", rows);

        List<String> ruleCodes = hits.stream().map(RuleHit::ruleCode).toList();
        if (created) {
            audit.record("ALERT", alert.getAlertRef(), "ALERT_CREATED", null, AlertStatus.OPEN.name(), ENGINE_ACTOR,
                    Map.of("rules", ruleCodes, "riskScore", alert.getRiskScore(), "triggerTxn", txn.txnRef()));
        } else {
            audit.record("ALERT", alert.getAlertRef(), "ALERT_AGGREGATED", alert.getStatus().name(), alert.getStatus().name(),
                    ENGINE_ACTOR, Map.of("rules", ruleCodes, "riskScoreBefore", scoreBefore,
                            "riskScoreAfter", alert.getRiskScore(), "triggerTxn", txn.txnRef()));
        }
        log.debug("{} alert {} for customer {} rules={} score={}", created ? "Created" : "Aggregated into",
                alert.getAlertRef(), txn.customerId(), ruleCodes, alert.getRiskScore());
        return new RaiseResult(alert, created);
    }

    public Alert get(long id) {
        return repository.findById(id).orElseThrow(() -> ApiException.notFound("Alert", id));
    }

    /** START_REVIEW, CLOSE and REOPEN. Serialised with detection for the same customer. */
    @Transactional
    public Alert transition(long alertId, AlertAction action, Disposition disposition, String reason) {
        Alert alert = lockAndLoad(alertId);
        AlertStatus from = alert.getStatus();
        String actor = CurrentUser.name();
        Map<String, Object> details = new LinkedHashMap<>();
        if (reason != null) {
            details.put("reason", reason);
        }

        switch (action) {
            case START_REVIEW -> {
                requireState(alert, action, AlertStatus.OPEN);
                alert.setStatus(AlertStatus.UNDER_REVIEW);
                alert.setAssignee(actor);
            }
            case CLOSE -> {
                requireState(alert, action, AlertStatus.OPEN, AlertStatus.UNDER_REVIEW);
                if (disposition == null) {
                    throw ApiException.unprocessable("DISPOSITION_REQUIRED", "A disposition is required to close an alert");
                }
                requireReason(reason);
                requireFourEyes(alert);
                alert.setStatus(AlertStatus.CLOSED);
                alert.setDisposition(disposition);
                alert.setDispositionReason(reason);
                alert.setDisposedBy(actor);
                alert.setDisposedAt(Instant.now());
                details.put("disposition", disposition.name());
            }
            case REOPEN -> {
                if (!CurrentUser.hasRole(Roles.SUPERVISOR)) {
                    throw new AccessDeniedException("Only supervisors can reopen alerts");
                }
                requireState(alert, action, AlertStatus.CLOSED);
                requireReason(reason);
                details.put("previousDisposition", String.valueOf(alert.getDisposition()));
                details.put("previousDisposedBy", String.valueOf(alert.getDisposedBy()));
                alert.setStatus(AlertStatus.UNDER_REVIEW);
                alert.setAssignee(actor);
                alert.setDisposition(null);
                alert.setDispositionReason(null);
                alert.setDisposedBy(null);
                alert.setDisposedAt(null);
            }
            case ESCALATE -> throw ApiException.badRequest("USE_CASE_ENDPOINT", "Escalation is handled by the case service");
        }
        alert.setUpdatedAt(Instant.now());
        audit.record("ALERT", alert.getAlertRef(), "ALERT_" + action.name(), from.name(), alert.getStatus().name(), details);
        return alert;
    }

    /** Used by the case service when an alert is escalated into (or closed with) a case. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Alert lockAndLoad(long alertId) {
        // Resolve the customer without loading the entity, take the lock, and only then load the alert so the
        // persistence context holds the latest committed state.
        List<Long> customer = jdbc.queryForList("SELECT customer_id FROM alert WHERE id = ?", Long.class, alertId);
        if (customer.isEmpty()) {
            throw ApiException.notFound("Alert", alertId);
        }
        customerLock.lock(customer.get(0));
        return get(alertId);
    }

    /**
     * Guardrail (four-eyes): a single analyst must not be able to clear the alerts most likely to be real laundering.
     * Critical-score alerts and any sanctions / high-risk-jurisdiction alert need a SUPERVISOR to close.
     */
    void requireFourEyes(Alert alert) {
        boolean sanctions = alert.getRuleDetails() != null
                && alert.getRuleDetails().containsKey(HighRiskJurisdictionRule.CODE);
        if ((alert.getRiskScore() >= supervisorCloseScore || sanctions) && !CurrentUser.hasRole(Roles.SUPERVISOR)) {
            throw new AccessDeniedException("Alert " + alert.getAlertRef() + " (score " + alert.getRiskScore()
                    + (sanctions ? ", sanctions match" : "") + ") can only be closed by a supervisor");
        }
    }

    public static void requireState(Alert alert, AlertAction action, AlertStatus... allowed) {
        for (AlertStatus s : allowed) {
            if (alert.getStatus() == s) {
                return;
            }
        }
        throw ApiException.conflict("INVALID_TRANSITION",
                "Cannot " + action + " alert " + alert.getAlertRef() + " in status " + alert.getStatus());
    }

    public static void requireReason(String reason) {
        if (reason == null || reason.trim().length() < 5) {
            throw ApiException.unprocessable("REASON_REQUIRED", "A reason of at least 5 characters is required");
        }
    }

    private Instant[] evidenceWindow(Set<Long> ids) {
        if (ids.isEmpty()) {
            return new Instant[]{null, null};
        }
        return jdbc.execute((ConnectionCallback<Instant[]>) con -> {
            Array arr = con.createArrayOf("bigint", ids.toArray());
            try (var ps = con.prepareStatement(
                    "SELECT MIN(occurred_at), MAX(occurred_at) FROM bank_transaction WHERE id = ANY (?)")) {
                ps.setArray(1, arr);
                try (var rs = ps.executeQuery()) {
                    rs.next();
                    OffsetDateTime a = rs.getObject(1, OffsetDateTime.class);
                    OffsetDateTime b = rs.getObject(2, OffsetDateTime.class);
                    return new Instant[]{a == null ? null : a.toInstant(), b == null ? null : b.toInstant()};
                }
            }
        });
    }
}
