package com.meridian.sentinel.customer;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;

/** KYC master record. Written by the ingestion layer (JDBC upsert); read through JPA. */
@Entity
@Table(name = "customer")
@Getter
@Setter
public class Customer {

    @Id
    private Long id;

    @Column(name = "external_ref")
    private String externalRef;

    @Column(name = "full_name")
    private String fullName;

    @Column(name = "national_id")
    private String nationalId;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Enumerated(EnumType.STRING)
    @Column(name = "customer_type")
    private CustomerType customerType;

    private String country;

    @Enumerated(EnumType.STRING)
    @Column(name = "kyc_risk_rating")
    private RiskRating kycRiskRating;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;
}
