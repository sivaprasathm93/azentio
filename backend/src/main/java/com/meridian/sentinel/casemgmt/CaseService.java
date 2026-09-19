package com.meridian.sentinel.casemgmt;

import com.meridian.sentinel.alert.Alert;
import com.meridian.sentinel.alert.AlertAction;
import com.meridian.sentinel.alert.AlertRepository;
import com.meridian.sentinel.alert.AlertService;
import com.meridian.sentinel.alert.AlertStatus;
import com.meridian.sentinel.alert.Disposition;
import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.common.CurrentUser;
import com.meridian.sentinel.common.Roles;
import com.meridian.sentinel.detection.CustomerLock;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Case workflow: OPEN -> INVESTIGATING -> SAR_FILED -> CLOSED (or OPEN/INVESTIGATING -> CLOSED).
 * Escalating an alert opens a case (or joins an existing open case of the same customer); closing a case closes
 * its escalated alerts with a disposition derived from the case outcome. Every change is audited.
 */
@Service
public class CaseService {

    private final CaseRepository cases;
    private final CaseNoteRepository notes;
    private final AlertRepository alertRepository;
    private final AlertService alertService;
    private final CustomerLock customerLock;
    private final AuditService audit;
    private final JdbcTemplate jdbc;

    public CaseService(CaseRepository cases, CaseNoteRepository notes, AlertRepository alertRepository,
                       AlertService alertService, CustomerLock customerLock, AuditService audit, JdbcTemplate jdbc) {
        this.cases = cases;
        this.notes = notes;
        this.alertRepository = alertRepository;
        this.alertService = alertService;
        this.customerLock = customerLock;
        this.audit = audit;
        this.jdbc = jdbc;
    }

    public Page<AmlCase> list(Collection<CaseStatus> statuses, Pageable pageable) {
        return cases.findByStatusIn(statuses, pageable);
    }

    public AmlCase get(long id) {
        return cases.findById(id).orElseThrow(() -> ApiException.notFound("Case", id));
    }

    /** Escalates one alert: joins {@code caseId} if given, otherwise opens a new case. */
    @Transactional
    public AmlCase escalate(long alertId, String reason, Long caseId) {
        AlertService.requireReason(reason);
        Alert alert = alertService.lockAndLoad(alertId);
        AlertService.requireState(alert, AlertAction.ESCALATE, AlertStatus.OPEN, AlertStatus.UNDER_REVIEW);
        AmlCase c;
        if (caseId == null) {
            c = newCase(alert.getCustomerId(), "Escalation of " + alert.getAlertRef(), alert.getRiskScore());
        } else {
            c = get(caseId);
            requireAttachable(c, alert);
        }
        attach(c, alert, reason);
        return c;
    }

    /** Opens a case from several alerts of the same customer. */
    @Transactional
    public AmlCase create(List<Long> alertIds, String title, String reason) {
        AlertService.requireReason(reason);
        if (alertIds == null || alertIds.isEmpty()) {
            throw ApiException.unprocessable("ALERTS_REQUIRED", "At least one alert is required to open a case");
        }
        List<Alert> alerts = new ArrayList<>();
        for (Long id : alertIds.stream().distinct().sorted().toList()) {
            alerts.add(alertService.lockAndLoad(id));
        }
        long customerId = alerts.get(0).getCustomerId();
        if (alerts.stream().anyMatch(a -> a.getCustomerId() != customerId)) {
            throw ApiException.unprocessable("MIXED_CUSTOMERS", "All alerts in a case must belong to the same customer");
        }
        for (Alert a : alerts) {
            AlertService.requireState(a, AlertAction.ESCALATE, AlertStatus.OPEN, AlertStatus.UNDER_REVIEW);
        }
        int maxScore = alerts.stream().mapToInt(Alert::getRiskScore).max().orElse(0);
        AmlCase c = newCase(customerId, title == null || title.isBlank() ? "Investigation of " + alerts.size() + " alert(s)" : title, maxScore);
        for (Alert a : alerts) {
            attach(c, a, reason);
        }
        return c;
    }

    @Transactional
    public AmlCase transition(long caseId, CaseStatus target, String reason, Disposition disposition) {
        AmlCase c = lockAndLoad(caseId);
        CaseStatus from = c.getStatus();
        if (!from.canMoveTo(target)) {
            throw ApiException.conflict("INVALID_TRANSITION", "Cannot move case " + c.getCaseRef() + " from " + from + " to " + target);
        }
        if (target.requiresSupervisor() && !CurrentUser.hasRole(Roles.SUPERVISOR)) {
            throw new AccessDeniedException("Only supervisors can move a case to " + target);
        }
        if (target == CaseStatus.CLOSED || target == CaseStatus.SAR_FILED) {
            AlertService.requireReason(reason);
        }
        Map<String, Object> details = new LinkedHashMap<>();
        if (reason != null) {
            details.put("reason", reason);
        }

        if (target == CaseStatus.INVESTIGATING && c.getAssignee() == null) {
            c.setAssignee(CurrentUser.name());
        }
        if (target == CaseStatus.CLOSED) {
            boolean sarFiled = from == CaseStatus.SAR_FILED;
            Disposition alertDisposition = sarFiled ? Disposition.TRUE_POSITIVE
                    : disposition == null ? Disposition.NO_FURTHER_ACTION : disposition;
            c.setOutcome(reason);
            details.put("alertDisposition", alertDisposition.name());
            for (Alert a : alertRepository.findByCaseIdOrderByRiskScoreDesc(c.getId())) {
                if (a.getStatus() == AlertStatus.ESCALATED) {
                    a.setStatus(AlertStatus.CLOSED);
                    a.setDisposition(alertDisposition);
                    a.setDispositionReason("Closed with case " + c.getCaseRef() + ": " + reason);
                    a.setDisposedBy(CurrentUser.name());
                    a.setDisposedAt(Instant.now());
                    a.setUpdatedAt(Instant.now());
                    audit.record("ALERT", a.getAlertRef(), "ALERT_CLOSED_WITH_CASE", AlertStatus.ESCALATED.name(),
                            AlertStatus.CLOSED.name(), Map.of("case", c.getCaseRef(), "disposition", alertDisposition.name()));
                }
            }
        }
        if (target == CaseStatus.SAR_FILED) {
            c.setOutcome(reason);
        }
        c.setStatus(target);
        c.setUpdatedAt(Instant.now());
        audit.record("CASE", c.getCaseRef(), "CASE_" + target.name(), from.name(), target.name(), details);
        return c;
    }

    @Transactional
    public AmlCase assign(long caseId, String assignee) {
        AmlCase c = lockAndLoad(caseId);
        if (c.getStatus() == CaseStatus.CLOSED) {
            throw ApiException.conflict("CASE_CLOSED", "Case " + c.getCaseRef() + " is closed");
        }
        String before = c.getAssignee();
        c.setAssignee(assignee);
        c.setUpdatedAt(Instant.now());
        audit.record("CASE", c.getCaseRef(), "CASE_ASSIGNED", c.getStatus().name(), c.getStatus().name(),
                Map.of("from", String.valueOf(before), "to", assignee));
        return c;
    }

    @Transactional
    public CaseNote addNote(long caseId, String body) {
        AmlCase c = get(caseId);
        if (c.getStatus() == CaseStatus.CLOSED) {
            throw ApiException.conflict("CASE_CLOSED", "Case " + c.getCaseRef() + " is closed");
        }
        CaseNote n = new CaseNote();
        n.setCaseId(caseId);
        n.setAuthor(CurrentUser.name());
        n.setBody(body);
        n.setCreatedAt(Instant.now());
        notes.save(n);
        audit.record("CASE", c.getCaseRef(), "CASE_NOTE_ADDED", c.getStatus().name(), c.getStatus().name(),
                Map.of("noteId", n.getId()));
        return n;
    }

    public List<CaseNote> notes(long caseId) {
        return notes.findByCaseIdOrderByCreatedAtAsc(caseId);
    }

    private AmlCase lockAndLoad(long caseId) {
        List<Long> customer = jdbc.queryForList("SELECT customer_id FROM aml_case WHERE id = ?", Long.class, caseId);
        if (customer.isEmpty()) {
            throw ApiException.notFound("Case", caseId);
        }
        customerLock.lock(customer.get(0));
        return get(caseId);
    }

    private AmlCase newCase(long customerId, String title, int riskScore) {
        AmlCase c = new AmlCase();
        c.setCaseRef("CASE-" + jdbc.queryForObject("SELECT nextval('case_ref_seq')", Long.class));
        c.setCustomerId(customerId);
        c.setTitle(title);
        c.setStatus(CaseStatus.OPEN);
        c.setPriority(priority(riskScore));
        c.setCreatedBy(CurrentUser.name());
        c.setCreatedAt(Instant.now());
        c.setUpdatedAt(Instant.now());
        cases.saveAndFlush(c);
        audit.record("CASE", c.getCaseRef(), "CASE_OPENED", null, CaseStatus.OPEN.name(),
                Map.of("customerId", customerId, "priority", c.getPriority()));
        return c;
    }

    private void requireAttachable(AmlCase c, Alert alert) {
        if (c.getStatus() == CaseStatus.CLOSED) {
            throw ApiException.conflict("CASE_CLOSED", "Case " + c.getCaseRef() + " is closed");
        }
        if (!c.getCustomerId().equals(alert.getCustomerId())) {
            throw ApiException.unprocessable("MIXED_CUSTOMERS", "Alert and case belong to different customers");
        }
    }

    private void attach(AmlCase c, Alert alert, String reason) {
        AlertStatus from = alert.getStatus();
        alert.setStatus(AlertStatus.ESCALATED);
        alert.setCaseId(c.getId());
        alert.setUpdatedAt(Instant.now());
        audit.record("ALERT", alert.getAlertRef(), "ALERT_ESCALATE", from.name(), AlertStatus.ESCALATED.name(),
                Map.of("case", c.getCaseRef(), "reason", reason));
        String p = priority(alert.getRiskScore());
        if (rank(p) > rank(c.getPriority())) {
            c.setPriority(p);
        }
        c.setUpdatedAt(Instant.now());
    }

    static String priority(int score) {
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

    private static int rank(String p) {
        return List.of("LOW", "MEDIUM", "HIGH", "CRITICAL").indexOf(p);
    }
}
