package com.meridian.sentinel.detection.config;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RuleConfigRepository extends JpaRepository<RuleConfig, String> {

    List<RuleConfig> findAllByOrderByRuleCode();
}
