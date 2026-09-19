package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.detection.DetectionHistory;
import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static com.meridian.sentinel.detection.Fixtures.T0;
import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static com.meridian.sentinel.detection.TxnView.Direction.DEBIT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BehavioralDeviationRuleTest {

    private final BehavioralDeviationRule rule = new BehavioralDeviationRule();
    // 3x of 90-day average, 30 days history, material day >= USD 2,500 (INR 208,750) or >= 10 txns
    private final BehavioralDeviationRule.Params params = new BehavioralDeviationRule.Params(
            new BigDecimal("3.0"), 90, 30, new BigDecimal("2500"), 10, "USD");
    private final Fixtures.History history = new Fixtures.History();

    /** 120 days of INR 20,000/day, so the 90-day lookback is fully populated (average exactly INR 20,000/day). */
    private void steadyHistory() {
        for (int d = 120; d >= 1; d--) {
            history.add(1, 1, DEBIT, "20000", "INR", T0.minus(Duration.ofDays(d)));
        }
    }

    @Test
    void dailyValueAboveThreeTimesTheRollingAverageTriggers() {
        steadyHistory();
        history.add(1, 1, CREDIT, "150000", "INR", T0);
        TxnView t = history.add(1, 1, DEBIT, "150000", "INR", T0.plus(Duration.ofHours(2)));

        RuleHit hit = rule.evaluate(Fixtures.ctx(t, history), params).orElseThrow();

        assertThat(hit.evidenceTxnIds()).hasSize(2);
        assertThat(hit.explanation()).contains("15.0x", "INR 20,000.00/day");
        assertThat(hit.severity()).isEqualTo(1.0); // 15x vs 3x => capped
    }

    @Test
    void materialButProportionateDayDoesNotTrigger() {
        for (int d = 120; d >= 1; d--) {
            history.add(1, 1, DEBIT, "100000", "INR", T0.minus(Duration.ofDays(d)));
        }
        TxnView t = history.add(1, 1, DEBIT, "250000", "INR", T0); // 2.5x

        assertThat(rule.evaluate(Fixtures.ctx(t, history), params)).isEmpty();
    }

    @Test
    void immaterialSpikeIsIgnoredEvenIfLargeRelativeToBaseline() {
        for (int d = 90; d >= 1; d--) {
            history.add(1, 1, DEBIT, "100", "INR", T0.minus(Duration.ofDays(d)));
        }
        TxnView t = history.add(1, 1, DEBIT, "50000", "INR", T0); // 500x but below INR 208,750

        assertThat(rule.evaluate(Fixtures.ctx(t, history), params)).isEmpty();
    }

    @Test
    void customersWithTooLittleHistoryAreNotJudged() {
        for (int d = 10; d >= 1; d--) {
            history.add(1, 1, DEBIT, "1000", "INR", T0.minus(Duration.ofDays(d)));
        }
        TxnView t = history.add(1, 1, CREDIT, "900000", "INR", T0);

        assertThat(rule.evaluate(Fixtures.ctx(t, history), params)).isEmpty();
    }

    @Test
    void transactionCountSpikeTriggersEvenWhenValueIsSmall() {
        steadyHistory(); // 1 txn/day
        TxnView last = null;
        for (int i = 0; i < 12; i++) {
            last = history.add(1, 1, DEBIT, "500", "INR", T0.plus(Duration.ofMinutes(i)));
        }

        RuleHit hit = rule.evaluate(Fixtures.ctx(last, history), params).orElseThrow();
        assertThat(hit.explanation()).contains("12 transactions today");
    }

    @Test
    void dormantCustomerReactivationTriggers() {
        DetectionHistory h = mock(DetectionHistory.class);
        TxnView t = new TxnView(99, "T99", 1, 1, CREDIT, new BigDecimal("900000"), "INR", new BigDecimal("900000"),
                null, "IN", "RTGS", "IN", T0);
        when(h.customerHistorySince(eq(t), any(Instant.class))).thenReturn(List.of(t));
        when(h.customerBaseline(eq(1L), any(), any()))
                .thenReturn(new DetectionHistory.Baseline(BigDecimal.ZERO, 0, T0.minus(Duration.ofDays(400))));

        RuleHit hit = rule.evaluate(new RuleContext(t, h, new Fixtures.Reference(), Fixtures.ZONE), params).orElseThrow();

        assertThat(hit.explanation()).contains("dormant reactivation");
        assertThat(hit.severity()).isEqualTo(1.0);
    }

    @Test
    void businessDayIsEvaluatedInTheBankTimeZone() {
        steadyHistory();
        // 00:30 IST on the 15th is still the 14th in UTC; it must count towards the IST business day of T0.
        TxnView earlyMorning = history.add(1, 1, CREDIT, "150000", "INR", Instant.parse("2026-06-14T19:00:00Z"));
        TxnView t = history.add(1, 1, DEBIT, "150000", "INR", T0);

        RuleHit hit = rule.evaluate(Fixtures.ctx(t, history), params).orElseThrow();
        assertThat(hit.evidenceTxnIds()).containsExactly(earlyMorning.id(), t.id());
    }
}
