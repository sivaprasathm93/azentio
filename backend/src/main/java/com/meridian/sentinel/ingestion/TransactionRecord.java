package com.meridian.sentinel.ingestion;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record TransactionRecord(
        @NotBlank @Size(max = 60) String txnRef,
        @NotBlank @Size(max = 40) String accountNumber,
        @NotBlank @Pattern(regexp = "CREDIT|DEBIT", message = "must be CREDIT or DEBIT") String direction,
        @NotNull @Positive @Digits(integer = 15, fraction = 4) BigDecimal amount,
        @NotBlank @Pattern(regexp = "[A-Z]{3}", message = "must be an ISO-4217 code") String currency,
        @Size(max = 200) String counterpartyName,
        @Size(max = 60) String counterpartyAccount,
        @Pattern(regexp = "[A-Z]{2}", message = "must be an ISO-3166 alpha-2 code") String counterpartyCountry,
        @NotBlank @Pattern(regexp = "CASH|WIRE|NEFT|RTGS|IMPS|UPI|CARD|ATM|CHEQUE|SWIFT",
                message = "must be one of CASH, WIRE, NEFT, RTGS, IMPS, UPI, CARD, ATM, CHEQUE, SWIFT") String channel,
        @Pattern(regexp = "[A-Z]{2}", message = "must be an ISO-3166 alpha-2 code") String jurisdiction,
        @NotNull Instant occurredAt) {

    public String key() {
        return txnRef;
    }
}
