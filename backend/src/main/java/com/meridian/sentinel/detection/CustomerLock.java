package com.meridian.sentinel.detection;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Serialises all alert-affecting work for one customer across threads <em>and</em> application instances using
 * a PostgreSQL transaction-scoped advisory lock. Detection of a customer's transactions, alert aggregation and
 * analyst actions on that customer's alerts therefore never interleave, which is what guarantees no duplicate
 * and no lost alerts under concurrent streams. Different customers proceed fully in parallel.
 */
@Component
public class CustomerLock {

    private final JdbcTemplate jdbc;

    public CustomerLock(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Blocks until the lock is held; released automatically at commit/rollback. Re-entrant within a transaction. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lock(long customerId) {
        jdbc.queryForObject("SELECT 1 FROM (SELECT pg_advisory_xact_lock(?)) l", Integer.class, customerId);
    }
}
