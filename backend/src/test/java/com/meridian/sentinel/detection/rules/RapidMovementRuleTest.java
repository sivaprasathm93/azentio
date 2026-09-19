package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;

import static com.meridian.sentinel.detection.Fixtures.T0;
import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static com.meridian.sentinel.detection.TxnView.Direction.DEBIT;
import static org.assertj.core.api.Assertions.assertThat;

class RapidMovementRuleTest {

    private final RapidMovementRule rule = new RapidMovementRule();
    private final RapidMovementRule.Params params =
            new RapidMovementRule.Params(48, new BigDecimal("0.80"), new BigDecimal("5000"), "USD");
    private final Fixtures.History history = new Fixtures.History();

    @Test
    void eightyPercentMovedOutWithin48hTriggersOnTheCompletingDebit() {
        TxnView in = history.add(1, 1, CREDIT, "1000000", "INR", T0);
        TxnView out1 = history.add(1, 1, DEBIT, "500000", "INR", T0.plus(Duration.ofHours(10)));
        TxnView out2 = history.add(1, 1, DEBIT, "300000", "INR", T0.plus(Duration.ofHours(30)));

        assertThat(rule.evaluate(Fixtures.ctx(out1, history), params)).as("50% so far").isEmpty();
        RuleHit hit = rule.evaluate(Fixtures.ctx(out2, history), params).orElseThrow();

        assertThat(hit.evidenceTxnIds()).containsExactly(in.id(), out1.id(), out2.id());
        assertThat(hit.severity()).isEqualTo(0.6);
        assertThat(hit.explanation()).contains("80.0%", "within 30h");
    }

    @Test
    void fullPassThroughHasMaximumSeverity() {
        history.add(1, 1, CREDIT, "1000000", "INR", T0);
        TxnView out = history.add(1, 1, DEBIT, "1000000", "INR", T0.plus(Duration.ofHours(2)));

        assertThat(rule.evaluate(Fixtures.ctx(out, history), params).orElseThrow().severity()).isEqualTo(1.0);
    }

    @Test
    void outflowAfterTheWindowDoesNotTrigger() {
        history.add(1, 1, CREDIT, "1000000", "INR", T0);
        TxnView out = history.add(1, 1, DEBIT, "950000", "INR", T0.plus(Duration.ofHours(49)));

        assertThat(rule.evaluate(Fixtures.ctx(out, history), params)).isEmpty();
    }

    @Test
    void creditsNeverTriggerAndDebitsBeforeTheFirstCreditAreIgnored() {
        history.add(1, 1, DEBIT, "900000", "INR", T0.minus(Duration.ofHours(1)));
        TxnView in = history.add(1, 1, CREDIT, "1000000", "INR", T0);
        TxnView smallOut = history.add(1, 1, DEBIT, "100000", "INR", T0.plus(Duration.ofHours(1)));

        assertThat(rule.evaluate(Fixtures.ctx(in, history), params)).isEmpty();
        assertThat(rule.evaluate(Fixtures.ctx(smallOut, history), params)).isEmpty();
    }

    @Test
    void immaterialInflowsAreIgnored() {
        // USD 5,000 min inflow = INR 417,500
        history.add(1, 1, CREDIT, "50000", "INR", T0);
        TxnView out = history.add(1, 1, DEBIT, "50000", "INR", T0.plus(Duration.ofHours(1)));

        assertThat(rule.evaluate(Fixtures.ctx(out, history), params)).isEmpty();
    }
}
