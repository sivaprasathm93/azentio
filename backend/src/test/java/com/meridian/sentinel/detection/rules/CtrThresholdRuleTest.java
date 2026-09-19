package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;

import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static org.assertj.core.api.Assertions.assertThat;

class CtrThresholdRuleTest {

    private final CtrThresholdRule rule = new CtrThresholdRule();
    private final CtrThresholdRule.Params params = new CtrThresholdRule.Params(new BigDecimal("10000"), "USD");
    private final Fixtures.History history = new Fixtures.History();

    @Test
    void flagsTransactionExactlyAtThresholdInForeignCurrency() {
        TxnView t = history.add(1, 1, CREDIT, "10000", "USD", Fixtures.T0);

        Optional<RuleHit> hit = rule.evaluate(Fixtures.ctx(t, history), params);

        assertThat(hit).isPresent();
        assertThat(hit.get().evidenceTxnIds()).containsExactly(t.id());
        assertThat(hit.get().severity()).isEqualTo(0.6);
        assertThat(hit.get().explanation()).contains("USD 10,000.00", "INR 835,000.00", "reporting threshold");
    }

    @Test
    void normalisesBaseCurrencyAmountsAgainstConvertedThreshold() {
        // INR 835,000 == USD 10,000 at 83.50
        TxnView atThreshold = history.add(1, 1, CREDIT, "835000", "INR", Fixtures.T0);
        TxnView justBelow = history.add(1, 1, CREDIT, "834999.99", "INR", Fixtures.T0);

        assertThat(rule.evaluate(Fixtures.ctx(atThreshold, history), params)).isPresent();
        assertThat(rule.evaluate(Fixtures.ctx(justBelow, history), params)).isEmpty();
    }

    @Test
    void severityGrowsWithSizeAndIsCapped() {
        TxnView twice = history.add(1, 1, CREDIT, "20000", "USD", Fixtures.T0);
        TxnView huge = history.add(1, 1, CREDIT, "1000000", "USD", Fixtures.T0);

        assertThat(rule.evaluate(Fixtures.ctx(twice, history), params).orElseThrow().severity()).isEqualTo(0.8);
        assertThat(rule.evaluate(Fixtures.ctx(huge, history), params).orElseThrow().severity()).isEqualTo(1.0);
    }
}
