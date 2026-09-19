package com.meridian.sentinel.reference;

import com.meridian.sentinel.common.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "Reference data", description = "Exchange rates (base currency normalisation) and high-risk / sanctions watchlist")
public class ReferenceDataController {

    private final ReferenceDataService service;

    public ReferenceDataController(ReferenceDataService service) {
        this.service = service;
    }

    public record RateUpdate(@NotNull @Positive BigDecimal rateToBase, Boolean confirmLargeChange) {
    }

    public record NewWatchlistEntry(@NotBlank @Pattern(regexp = "COUNTRY|COUNTERPARTY") String entryType,
                                    @NotBlank @Size(max = 200) String value,
                                    @NotBlank @Size(max = 60) String listName,
                                    @Size(max = 300) String reason) {
    }

    public record WatchlistToggle(@NotNull Boolean active, @Size(max = 300) String reason) {
    }

    @GetMapping("/fx-rates")
    @PreAuthorize("hasRole('ANALYST')")
    public List<ExchangeRate> rates() {
        return service.rates();
    }

    @PutMapping("/fx-rates/{currency}")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "Create or update the rate to the base currency (applies to transactions ingested afterwards)",
            description = "Guardrail: a move of more than 10% is rejected with 422 FX_RATE_DEVIATION unless confirmLargeChange=true")
    public ExchangeRate setRate(@PathVariable @Pattern(regexp = "[A-Z]{3}") String currency, @Valid @RequestBody RateUpdate body) {
        return service.upsertRate(currency, body.rateToBase(), Boolean.TRUE.equals(body.confirmLargeChange()));
    }

    @GetMapping("/watchlist")
    @PreAuthorize("hasRole('ANALYST')")
    public List<WatchlistEntry> watchlist() {
        return service.watchlist();
    }

    @PostMapping("/watchlist")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    public WatchlistEntry add(@Valid @RequestBody NewWatchlistEntry body) {
        if ("COUNTRY".equals(body.entryType()) && !body.value().matches("[A-Za-z]{2}")) {
            throw ApiException.badRequest("INVALID_COUNTRY", "COUNTRY entries must be ISO alpha-2 codes");
        }
        return service.addWatchlistEntry(body.entryType(), body.value(), body.listName(), body.reason());
    }

    @PatchMapping("/watchlist/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "Activate / deactivate an entry (entries are never deleted, for auditability)")
    public WatchlistEntry toggle(@PathVariable long id, @Valid @RequestBody WatchlistToggle body) {
        return service.setWatchlistActive(id, body.active(), body.reason());
    }
}
