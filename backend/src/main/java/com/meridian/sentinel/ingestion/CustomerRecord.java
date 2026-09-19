package com.meridian.sentinel.ingestion;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record CustomerRecord(
        @NotBlank @Size(max = 40) String externalRef,
        @NotBlank @Size(max = 200) String fullName,
        @NotBlank @Size(max = 40) String nationalId,
        @Past LocalDate dateOfBirth,
        @NotBlank @Pattern(regexp = "RETAIL|BUSINESS", message = "must be RETAIL or BUSINESS") String customerType,
        @NotBlank @Pattern(regexp = "[A-Z]{2}", message = "must be an ISO-3166 alpha-2 code") String country,
        @NotBlank @Pattern(regexp = "LOW|MEDIUM|HIGH", message = "must be LOW, MEDIUM or HIGH") String kycRiskRating) {

    public String key() {
        return externalRef;
    }
}
