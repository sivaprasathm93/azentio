package com.meridian.sentinel.alert;

/** Analyst actions on an alert. ESCALATE is handled by the case service (it opens or joins a case). */
public enum AlertAction {
    START_REVIEW, CLOSE, ESCALATE, REOPEN
}
