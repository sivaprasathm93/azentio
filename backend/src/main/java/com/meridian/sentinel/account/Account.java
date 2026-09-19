package com.meridian.sentinel.account;

import com.meridian.sentinel.customer.RiskRating;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Entity
@Table(name = "account")
@Getter
@Setter
public class Account {

    @Id
    private Long id;

    @Column(name = "account_number")
    private String accountNumber;

    @Column(name = "customer_id")
    private Long customerId;

    @Column(name = "account_type")
    private String accountType;

    private String currency;

    @Column(name = "opened_on")
    private LocalDate openedOn;

    @Enumerated(EnumType.STRING)
    @Column(name = "risk_rating")
    private RiskRating riskRating;

    private String status;
}
