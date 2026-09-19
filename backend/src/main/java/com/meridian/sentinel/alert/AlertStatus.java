package com.meridian.sentinel.alert;

public enum AlertStatus {
    OPEN, UNDER_REVIEW, ESCALATED, CLOSED;

    /** Alerts that can still absorb new evidence for the same customer. */
    public boolean isAggregatable() {
        return this == OPEN || this == UNDER_REVIEW;
    }
}
