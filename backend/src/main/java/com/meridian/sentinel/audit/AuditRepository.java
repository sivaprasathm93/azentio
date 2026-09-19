package com.meridian.sentinel.audit;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AuditRepository extends JpaRepository<AuditLog, Long> {

    List<AuditLog> findByEntityTypeAndEntityIdOrderByOccurredAtAscIdAsc(String entityType, String entityId);

    List<AuditLog> findTop200ByOrderByIdDesc();
}
