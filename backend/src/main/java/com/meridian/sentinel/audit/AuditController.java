package com.meridian.sentinel.audit;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/audit")
@Tag(name = "Audit", description = "Immutable audit trail")
public class AuditController {

    private final AuditRepository repository;

    public AuditController(AuditRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    @PreAuthorize("hasRole('SUPERVISOR')")
    @Operation(summary = "Audit entries for one entity (e.g. entityType=ALERT&entityId=ALT-100001), or the latest 200")
    public List<AuditLog> list(@RequestParam(required = false) String entityType,
                               @RequestParam(required = false) String entityId) {
        if (entityType != null && entityId != null) {
            return repository.findByEntityTypeAndEntityIdOrderByOccurredAtAscIdAsc(entityType, entityId);
        }
        return repository.findTop200ByOrderByIdDesc();
    }
}
