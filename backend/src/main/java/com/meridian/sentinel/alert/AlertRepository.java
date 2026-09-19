package com.meridian.sentinel.alert;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface AlertRepository extends JpaRepository<Alert, Long> {

    /** Open/under-review alerts of a customer whose evidence window overlaps [from, to], newest first. */
    @Query("""
            SELECT a FROM Alert a
            WHERE a.customerId = :customerId AND a.status IN :statuses
              AND a.windowEnd >= :from AND a.windowStart <= :to
            ORDER BY a.windowEnd DESC, a.id DESC""")
    List<Alert> findAggregationCandidates(@Param("customerId") long customerId,
                                          @Param("statuses") Collection<AlertStatus> statuses,
                                          @Param("from") Instant from, @Param("to") Instant to);

    List<Alert> findByCaseIdOrderByRiskScoreDesc(Long caseId);

    List<Alert> findByIdIn(Collection<Long> ids);
}
