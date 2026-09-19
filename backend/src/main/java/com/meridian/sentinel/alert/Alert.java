package com.meridian.sentinel.alert;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** An alert is never deleted (DB trigger); closing records disposition, reason and analyst identity. */
@Entity
@Table(name = "alert")
@Getter
@Setter
public class Alert {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "alert_ref")
    private String alertRef;

    @Column(name = "customer_id")
    private Long customerId;

    @Enumerated(EnumType.STRING)
    private AlertStatus status;

    @Column(name = "risk_score")
    private int riskScore;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "rule_codes", columnDefinition = "text[]")
    private String[] ruleCodes;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "rule_details")
    private Map<String, RuleDetail> ruleDetails = new LinkedHashMap<>();

    private String explanation;

    @Column(name = "window_start")
    private Instant windowStart;

    @Column(name = "window_end")
    private Instant windowEnd;

    @Column(name = "hit_count")
    private int hitCount;

    private String assignee;

    @Enumerated(EnumType.STRING)
    private Disposition disposition;

    @Column(name = "disposition_reason")
    private String dispositionReason;

    @Column(name = "disposed_by")
    private String disposedBy;

    @Column(name = "disposed_at")
    private Instant disposedAt;

    @Column(name = "case_id")
    private Long caseId;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;
}
