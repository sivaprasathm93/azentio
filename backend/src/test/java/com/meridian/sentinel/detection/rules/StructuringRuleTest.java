package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;

import static com.meridian.sentinel.detection.Fixtures.T0;
import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static org.assertj.core.api.Assertions.assertThat;

class StructuringRuleTest {

    private final StructuringRule rule = new StructuringRule();
    private final StructuringRule.Params params =
            new StructuringRule.Params(new BigDecimal("9000"), new BigDecimal("9999.99"), "USD", 3, 24);
    private final Fixtures.History history = new Fixtures.History();

    @Test
    void threeJustBelowThresholdDepositsWithin24hTrigger() {
        TxnView a = history.add(1, 1, CREDIT, "9500", "USD", T0);
        TxnView b = history.add(1, 1, CREDIT, "9800", "USD", T0.plus(Duration.ofHours(5)));
        TxnView c = history.add(1, 1, CREDIT, "9100", "USD", T0.plus(Duration.ofHours(20)));

        assertThat(rule.evaluate(Fixtures.ctx(b, history), params)).as("only two so far").isEmpty();
        RuleHit hit = rule.evaluate(Fixtures.ctx(c, history), params).orElseThrow();

        assertThat(hit.evidenceTxnIds()).containsExactly(a.id(), b.id(), c.id());
        assertThat(hit.severity()).isEqualTo(0.7);
        assertThat(hit.explanation()).startsWith("3 transactions").contains("24h", "USD 9,500.00");
    }

    @Test
    void transactionsOutsideTheWindowDoNotCount() {
        history.add(1, 1, CREDIT, "9500", "USD", T0);
        history.add(1, 1, CREDIT, "9800", "USD", T0.plus(Duration.ofHours(10)));
        TxnView late = history.add(1, 1, CREDIT, "9100", "USD", T0.plus(Duration.ofHours(25)));

        assertThat(rule.evaluate(Fixtures.ctx(late, history), params)).isEmpty();
    }

    @Test
    void amountsOutsideTheBandDoNotCount() {
        history.add(1, 1, CREDIT, "8999.99", "USD", T0);   // below band
        history.add(1, 1, CREDIT, "10000", "USD", T0.plusSeconds(60)); // at threshold (CTR, not structuring)
        history.add(1, 1, CREDIT, "9500", "USD", T0.plusSeconds(120));
        TxnView t = history.add(1, 1, CREDIT, "9600", "USD", T0.plusSeconds(180));

        assertThat(rule.evaluate(Fixtures.ctx(t, history), params)).isEmpty();
    }

    @Test
    void worksInBaseCurrencyAndIsScopedToOneAccount() {
        // INR 780,000 ~ USD 9,341 -> in band
        history.add(1, 1, CREDIT, "780000", "INR", T0);
        history.add(2, 1, CREDIT, "790000", "INR", T0.plusSeconds(60)); // other account of same customer
        history.add(1, 1, CREDIT, "800000", "INR", T0.plusSeconds(120));
        TxnView t = history.add(1, 1, CREDIT, "810000", "INR", T0.plusSeconds(180));

        RuleHit hit = rule.evaluate(Fixtures.ctx(t, history), params).orElseThrow();
        assertThat(hit.evidenceTxnIds()).hasSize(3);
    }

    @Test
    void severityIncreasesWithEachAdditionalStructuredDeposit() {
        for (int i = 0; i < 5; i++) {
            history.add(1, 1, CREDIT, "9400", "USD", T0.plus(Duration.ofHours(i)));
        }
        TxnView sixth = history.add(1, 1, CREDIT, "9400", "USD", T0.plus(Duration.ofHours(6)));

        assertThat(rule.evaluate(Fixtures.ctx(sixth, history), params).orElseThrow().severity()).isEqualTo(1.0);
    }

    @Test
    void triggeringTransactionMustItselfBeInBand() {
        history.add(1, 1, CREDIT, "9500", "USD", T0);
        history.add(1, 1, CREDIT, "9500", "USD", T0.plusSeconds(60));
        history.add(1, 1, CREDIT, "9500", "USD", T0.plusSeconds(120));
        TxnView small = history.add(1, 1, CREDIT, "50", "USD", T0.plusSeconds(180));

        assertThat(rule.evaluate(Fixtures.ctx(small, history), params)).isEmpty();
    }
}
