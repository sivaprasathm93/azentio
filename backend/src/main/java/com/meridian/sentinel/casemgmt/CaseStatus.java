package com.meridian.sentinel.casemgmt;

import java.util.Map;
import java.util.Set;

public enum CaseStatus {
    OPEN, INVESTIGATING, SAR_FILED, CLOSED;

    private static final Map<CaseStatus, Set<CaseStatus>> ALLOWED = Map.of(
            OPEN, Set.of(INVESTIGATING, CLOSED),
            INVESTIGATING, Set.of(SAR_FILED, CLOSED),
            SAR_FILED, Set.of(CLOSED),
            CLOSED, Set.of());

    public boolean canMoveTo(CaseStatus target) {
        return ALLOWED.get(this).contains(target);
    }

    /** Filing a SAR and closing a case are supervisor decisions. */
    public boolean requiresSupervisor() {
        return this == SAR_FILED || this == CLOSED;
    }
}
