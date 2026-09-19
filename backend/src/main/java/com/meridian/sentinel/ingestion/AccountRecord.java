package com.meridian.sentinel.ingestion;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record AccountRecord(
        @NotBlank @Size(max = 40) String accountNumber,
        @NotBlank @Size(max = 40) String customerRef,
        @NotBlank @Pattern(regexp = "SAVINGS|CURRENT|BUSINESS|NRE|WALLET",
                message = "must be SAVINGS, CURRENT, BUSINESS, NRE or WALLET") String accountType,
        @NotBlank @Pattern(regexp = "[A-Z]{3}", message = "must be an ISO-4217 code") String currency,
        @NotNull @PastOrPresent LocalDate openedOn,
        @NotBlank @Pattern(regexp = "LOW|MEDIUM|HIGH", message = "must be LOW, MEDIUM or HIGH") String riskRating,
        @Pattern(regexp = "ACTIVE|DORMANT|FROZEN|CLOSED", message = "must be ACTIVE, DORMANT, FROZEN or CLOSED") String status) {

    public String key() {
        return accountNumber;
    }
}
