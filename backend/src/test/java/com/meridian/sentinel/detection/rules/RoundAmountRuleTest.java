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

class RoundAmountRuleTest {

    private final RoundAmountRule rule = new RoundAmountRule();
    // multiples of 1,000, each >= USD 1,000 (INR 83,500), 3 within 7 days
    private final RoundAmountRule.Params params =
            new RoundAmountRule.Params(new BigDecimal("1000"), new BigDecimal("1000"), "USD", 3, 168);
    private final Fixtures.History history = new Fixtures.History();

    @Test
    void repeatedRoundAmountsWithinAWeekTrigger() {
        TxnView a = history.add(1, 1, CREDIT, "5000", "USD", T0);
        TxnView b = history.add(1, 1, DEBIT, "200000", "INR", T0.plus(Duration.ofDays(2)));
        history.add(1, 1, DEBIT, "123456.78", "INR", T0.plus(Duration.ofDays(3)));
        TxnView c = history.add(1, 1, CREDIT, "7000", "USD", T0.plus(Duration.ofDays(6)));

        RuleHit hit = rule.evaluate(Fixtures.ctx(c, history), params).orElseThrow();

        assertThat(hit.evidenceTxnIds()).containsExactly(a.id(), b.id(), c.id());
        assertThat(hit.severity()).isEqualTo(0.5);
        assertThat(hit.explanation()).contains("multiples of 1000", "USD 7,000.00");
    }

    @Test
    void smallRoundAmountsAreNotSuspicious() {
        history.add(1, 1, DEBIT, "5000", "INR", T0);
        history.add(1, 1, DEBIT, "10000", "INR", T0.plusSeconds(60));
        TxnView t = history.add(1, 1, DEBIT, "20000", "INR", T0.plusSeconds(120));

        assertThat(rule.evaluate(Fixtures.ctx(t, history), params)).isEmpty();
    }

    @Test
    void nonRoundTriggerDoesNotFire() {
        history.add(1, 1, CREDIT, "5000", "USD", T0);
        history.add(1, 1, CREDIT, "6000", "USD", T0.plusSeconds(60));
        history.add(1, 1, CREDIT, "7000", "USD", T0.plusSeconds(120));
        TxnView t = history.add(1, 1, CREDIT, "7000.50", "USD", T0.plusSeconds(180));

        assertThat(rule.evaluate(Fixtures.ctx(t, history), params)).isEmpty();
    }

    @Test
    void roundnessIsJudgedOnTheOriginalAmount() {
        TxnView t = history.add(1, 1, CREDIT, "5000.0000", "USD", T0);
        assertThat(RoundAmountRule.isRound(t, new BigDecimal("1000"), new BigDecimal("83500"))).isTrue();
    }
}
