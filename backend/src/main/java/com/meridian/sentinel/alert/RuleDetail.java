package com.meridian.sentinel.alert;

/** Per-rule contribution to an alert, stored as JSON on the alert. */
public record RuleDetail(double severity, int hits, int ruleVersion, int weight, String explanation, String lastTxnRef) {
}
