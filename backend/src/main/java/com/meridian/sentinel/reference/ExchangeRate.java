package com.meridian.sentinel.reference;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "exchange_rate")
@Getter
@Setter
public class ExchangeRate {

    @Id
    private String currency;

    @Column(name = "rate_to_base")
    private BigDecimal rateToBase;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "updated_by")
    private String updatedBy;
}
