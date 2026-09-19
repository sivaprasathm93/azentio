package com.meridian.sentinel.casemgmt;

import com.meridian.sentinel.alert.AlertQueryService;
import com.meridian.sentinel.alert.AlertViews.AlertSummary;
import com.meridian.sentinel.alert.Disposition;
import com.meridian.sentinel.audit.AuditLog;
import com.meridian.sentinel.audit.AuditRepository;
import com.meridian.sentinel.common.PageResponse;
import com.meridian.sentinel.customer.CustomerView;
import com.meridian.sentinel.customer.PiiAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.EnumSet;
import java.util.List;

@RestController
@RequestMapping("/api/v1/cases")
@Tag(name = "Cases", description = "Investigation case management")
@PreAuthorize("hasRole('ANALYST')")
public class CaseController {

    private final CaseService service;
    private final AlertQueryService alertQueries;
    private final PiiAccessService piiAccess;
    private final AuditRepository auditRepository;

    public CaseController(CaseService service, AlertQueryService alertQueries, PiiAccessService piiAccess,
                          AuditRepository auditRepository) {
        this.service = service;
        this.alertQueries = alertQueries;
        this.piiAccess = piiAccess;
        this.auditRepository = auditRepository;
    }

    public record CreateCase(@NotEmpty List<Long> alertIds, @Size(max = 200) String title, @NotBlank @Size(max = 1000) String reason) {
    }

    public record Transition(@NotNull CaseStatus status, @Size(max = 1000) String reason, Disposition disposition) {
    }

    public record Assign(@NotBlank @Size(max = 60) String assignee) {
    }

    public record NewNote(@NotBlank @Size(max = 4000) String body) {
    }

    public record CaseDetail(AmlCase caseInfo, CustomerView customer, List<AlertSummary> alerts, List<CaseNote> notes,
                             List<AuditLog> history) {
    }

    @GetMapping
    @Operation(summary = "Cases, most recently updated first")
    public PageResponse<AmlCase> list(@RequestParam(required = false) List<CaseStatus> status,
                                      @RequestParam(defaultValue = "0") @Min(0) int page,
                                      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
        EnumSet<CaseStatus> statuses = status == null || status.isEmpty() ? EnumSet.allOf(CaseStatus.class) : EnumSet.copyOf(status);
        Page<AmlCase> p = service.list(statuses, PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt")));
        return PageResponse.of(p.getContent(), page, size, p.getTotalElements());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Open a case from one or more alerts of the same customer (alerts become ESCALATED)")
    public CaseDetail create(@Valid @RequestBody CreateCase body) {
        return detail(service.create(body.alertIds(), body.title(), body.reason()).getId());
    }

    @GetMapping("/{id}")
    public CaseDetail get(@PathVariable long id) {
        return detail(id);
    }

    @PostMapping("/{id}/transition")
    @Operation(summary = "Move a case: INVESTIGATING | SAR_FILED (SUPERVISOR) | CLOSED (SUPERVISOR; closes escalated alerts)",
            description = "409 for a transition not allowed from the current status, 403 if the role is insufficient")
    public CaseDetail transition(@PathVariable long id, @Valid @RequestBody Transition body) {
        service.transition(id, body.status(), body.reason(), body.disposition());
        return detail(id);
    }

    @PostMapping("/{id}/assign")
    public CaseDetail assign(@PathVariable long id, @Valid @RequestBody Assign body) {
        service.assign(id, body.assignee());
        return detail(id);
    }

    @PostMapping("/{id}/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public CaseNote addNote(@PathVariable long id, @Valid @RequestBody NewNote body) {
        return service.addNote(id, body.body());
    }

    private CaseDetail detail(long id) {
        AmlCase c = service.get(id);
        return new CaseDetail(c, piiAccess.detailView(c.getCustomerId(), "case " + c.getCaseRef()),
                alertQueries.byCase(id), service.notes(id),
                auditRepository.findByEntityTypeAndEntityIdOrderByOccurredAtAscIdAsc("CASE", c.getCaseRef()));
    }
}
