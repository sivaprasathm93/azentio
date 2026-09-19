package com.meridian.sentinel.detection.config;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "rule_config")
@Getter
@Setter
public class RuleConfig {

    @Id
    @Column(name = "rule_code")
    private String ruleCode;

    private String name;

    private String description;

    private boolean enabled;

    private int weight;

    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> params;

    private int version;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "updated_at")
    private Instant updatedAt;
}
