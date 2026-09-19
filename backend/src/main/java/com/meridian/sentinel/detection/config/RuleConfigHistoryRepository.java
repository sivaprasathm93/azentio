package com.meridian.sentinel.detection.config;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RuleConfigHistoryRepository extends JpaRepository<RuleConfigHistory, Long> {

    List<RuleConfigHistory> findByRuleCodeOrderByVersionDesc(String ruleCode);
}
