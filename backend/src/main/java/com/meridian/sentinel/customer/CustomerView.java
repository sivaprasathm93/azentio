package com.meridian.sentinel.customer;

import com.meridian.sentinel.common.PiiMasker;

import java.time.LocalDate;

/** Customer as exposed by the API. PII is masked unless the caller is entitled to see it (Business Rule 8). */
public record CustomerView(long id, String externalRef, String fullName, String nationalId, LocalDate dateOfBirth,
                           String customerType, String country, String kycRiskRating, boolean piiMasked) {

    public static CustomerView of(Customer c, boolean unmasked) {
        return new CustomerView(c.getId(), c.getExternalRef(),
                unmasked ? c.getFullName() : PiiMasker.maskName(c.getFullName()),
                unmasked ? c.getNationalId() : PiiMasker.maskId(c.getNationalId()),
                unmasked ? c.getDateOfBirth() : null,
                c.getCustomerType().name(), c.getCountry(), c.getKycRiskRating().name(), !unmasked);
    }
}
