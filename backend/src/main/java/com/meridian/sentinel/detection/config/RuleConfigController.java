package com.meridian.sentinel.detection.config;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/rules")
@Tag(name = "Rules", description = "View and tune detection rules at runtime (no redeployment)")
public class RuleConfigController {

    private final RuleConfigService service;

    public RuleConfigController(RuleConfigService service) {
        this.service = service;
    }

    public record RuleUpdate(Boolean enabled, @Min(0) @Max(100) Integer weight, Map<String, Object> params) {
    }

    @GetMapping
    @PreAuthorize("hasRole('ANALYST')")
    @Operation(summary = "All rules with current thresholds, weights and version")
    public List<RuleConfig> list() {
        return service.findAll();
    }

    @GetMapping("/{code}")
    @PreAuthorize("hasRole('ANALYST')")
    public RuleConfig get(@PathVariable String code) {
        return service.get(code);
    }

    @GetMapping("/{code}/history")
    @PreAuthorize("hasRole('ANALYST')")
    @Operation(summary = "Every past version of a rule's configuration")
    public List<RuleConfigHistory> history(@PathVariable String code) {
        return service.history(code);
    }

    @PatchMapping("/{code}")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "Toggle / re-weight / tune a rule. params are merged over the current ones and validated; "
            + "422 if invalid. Takes effect for the next evaluated transaction.")
    public RuleConfig update(@PathVariable String code, @RequestBody @Valid RuleUpdate body) {
        return service.update(code, body.enabled(), body.weight(), body.params());
    }
}
