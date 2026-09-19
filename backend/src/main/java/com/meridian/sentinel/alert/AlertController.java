package com.meridian.sentinel.alert;

import com.meridian.sentinel.alert.AlertViews.AlertDetail;
import com.meridian.sentinel.alert.AlertViews.AlertSummary;
import com.meridian.sentinel.audit.AuditLog;
import com.meridian.sentinel.audit.AuditRepository;
import com.meridian.sentinel.casemgmt.CaseService;
import com.meridian.sentinel.common.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/alerts")
@Tag(name = "Alerts", description = "Analyst alert queue, evidence and disposition workflow")
@PreAuthorize("hasRole('ANALYST')")
public class AlertController {

    private final AlertQueryService queries;
    private final AlertService alerts;
    private final CaseService cases;
    private final AuditRepository auditRepository;

    public AlertController(AlertQueryService queries, AlertService alerts, CaseService cases, AuditRepository auditRepository) {
        this.queries = queries;
        this.alerts = alerts;
        this.cases = cases;
        this.auditRepository = auditRepository;
    }

    public record ActionRequest(@NotNull AlertAction action, Disposition disposition,
                                @Size(max = 1000) String reason, Long caseId) {
    }

    @GetMapping
    @Operation(summary = "Alert queue (PII masked), highest risk first by default")
    public PageResponse<AlertSummary> list(@RequestParam(required = false) List<AlertStatus> status,
                                           @RequestParam(required = false) @Min(0) @Max(100) Integer minScore,
                                           @RequestParam(required = false) String ruleCode,
                                           @RequestParam(required = false) Long customerId,
                                           @RequestParam(required = false) String assignee,
                                           @RequestParam(defaultValue = "0") @Min(0) int page,
                                           @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
                                           @RequestParam(defaultValue = "riskScore") String sort,
                                           @RequestParam(defaultValue = "desc") String direction) {
        return queries.list(new AlertQueryService.Filter(status, minScore, ruleCode, customerId, assignee),
                page, size, sort, direction);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Alert detail: explanation per rule, evidence transactions, customer (PII visible to SUPERVISOR+)")
    public AlertDetail get(@PathVariable long id) {
        return queries.detail(id);
    }

    @GetMapping("/{id}/history")
    @Operation(summary = "Immutable audit trail of this alert (creation, aggregation, every state transition)")
    public List<AuditLog> history(@PathVariable long id) {
        return auditRepository.findByEntityTypeAndEntityIdOrderByOccurredAtAscIdAsc("ALERT", alerts.get(id).getAlertRef());
    }

    @PostMapping("/{id}/actions")
    @Operation(summary = "START_REVIEW | CLOSE (disposition + reason) | ESCALATE (reason, optional caseId) | REOPEN (SUPERVISOR)",
            description = "409 if the action is not allowed from the alert's current status; 422 if disposition/reason is missing")
    public AlertDetail act(@PathVariable long id, @Valid @RequestBody ActionRequest body) {
        if (body.action() == AlertAction.ESCALATE) {
            cases.escalate(id, body.reason(), body.caseId());
        } else {
            alerts.transition(id, body.action(), body.disposition(), body.reason());
        }
        return queries.detail(id);
    }
}
