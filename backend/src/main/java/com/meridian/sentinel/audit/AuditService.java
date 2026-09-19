package com.meridian.sentinel.audit;

import com.meridian.sentinel.common.CurrentUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;

@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final AuditRepository repository;

    public AuditService(AuditRepository repository) {
        this.repository = repository;
    }

    /** Records an immutable audit entry in the caller's transaction, so it commits or rolls back with the change. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(String entityType, Object entityId, String action, String fromState, String toState,
                       Map<String, Object> details) {
        record(entityType, entityId, action, fromState, toState, CurrentUser.name(), details);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(String entityType, Object entityId, String action, String fromState, String toState,
                       String actor, Map<String, Object> details) {
        AuditLog entry = new AuditLog();
        entry.setEntityType(entityType);
        entry.setEntityId(String.valueOf(entityId));
        entry.setAction(action);
        entry.setFromState(fromState);
        entry.setToState(toState);
        entry.setActor(actor);
        entry.setDetails(details);
        entry.setOccurredAt(Instant.now());
        repository.save(entry);
        log.info("AUDIT {} {} {} {}->{} by {}", entityType, entityId, action, fromState, toState, actor);
    }
}
