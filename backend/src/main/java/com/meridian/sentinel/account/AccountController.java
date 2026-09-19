package com.meridian.sentinel.account;

import com.meridian.sentinel.alert.AlertService;
import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.detection.CustomerLock;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/accounts")
@Tag(name = "Accounts", description = "Account holds placed by the loss-prevention guardrails")
@PreAuthorize("hasRole('ANALYST')")
public class AccountController {

    private final AccountRepository accounts;
    private final JdbcTemplate jdbc;
    private final CustomerLock customerLock;
    private final AuditService audit;

    public AccountController(AccountRepository accounts, JdbcTemplate jdbc, CustomerLock customerLock, AuditService audit) {
        this.accounts = accounts;
        this.jdbc = jdbc;
        this.customerLock = customerLock;
        this.audit = audit;
    }

    public record Unfreeze(@NotBlank @Size(min = 10, max = 1000) String reason) {
    }

    @GetMapping
    @Operation(summary = "Accounts by status (e.g. status=FROZEN for accounts frozen after a sanctions hit)")
    public List<Map<String, Object>> list(@RequestParam(defaultValue = "FROZEN") String status) {
        return jdbc.queryForList("""
                SELECT a.id, a.account_number, a.customer_id, c.external_ref, a.account_type, a.currency, a.status
                FROM account a JOIN customer c ON c.id = a.customer_id WHERE a.status = ? ORDER BY a.id""", status);
    }

    @PostMapping("/{id}/unfreeze")
    @PreAuthorize("hasRole('SUPERVISOR')")
    @Transactional
    @Operation(summary = "Lift an automatic freeze (SUPERVISOR only, reason required, audited)",
            description = "409 if the account is not frozen")
    public Account unfreeze(@PathVariable long id, @Valid @RequestBody Unfreeze body) {
        Account a = accounts.findById(id).orElseThrow(() -> ApiException.notFound("Account", id));
        customerLock.lock(a.getCustomerId());
        if (!"FROZEN".equals(a.getStatus())) {
            throw ApiException.conflict("NOT_FROZEN", "Account " + a.getAccountNumber() + " is " + a.getStatus());
        }
        a.setStatus("ACTIVE");
        audit.record("ACCOUNT", id, "ACCOUNT_UNFROZEN", "FROZEN", "ACTIVE", Map.of("reason", body.reason()));
        return a;
    }
}
