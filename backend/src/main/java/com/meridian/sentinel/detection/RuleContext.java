package com.meridian.sentinel.detection;

import java.time.ZoneId;

/** Everything a rule may look at when evaluating one transaction. */
public record RuleContext(TxnView txn, DetectionHistory history, ReferenceData reference, ZoneId zone) {
}
