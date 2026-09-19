package com.meridian.sentinel.detection;

import com.meridian.sentinel.detection.config.ActiveRule;
import com.meridian.sentinel.detection.config.RuleConfigService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DetectionEngineTest {

    @SuppressWarnings("unchecked")
    private static ActiveRule rule(String code, Optional<RuleHit> result, boolean fail) {
        DetectionRule<Object> r = mock(DetectionRule.class);
        when(r.code()).thenReturn(code);
        if (fail) {
            when(r.evaluate(any(), any())).thenThrow(new IllegalStateException("boom"));
        } else {
            when(r.evaluate(any(), any())).thenReturn(result);
        }
        return new ActiveRule(r, new Object(), true, 10, 1);
    }

    @Test
    void collectsHitsFromAllRulesAndIsolatesAFailingRule() {
        RuleConfigService configs = mock(RuleConfigService.class);
        RuleHit hit = new RuleHit("B", 0.5, List.of(1L), "b fired");
        List<ActiveRule> rules = List.of(
                rule("A", Optional.empty(), false),
                rule("BROKEN", Optional.empty(), true),
                rule("B", Optional.of(hit), false));
        when(configs.activeRules()).thenReturn(rules);
        Fixtures.History history = new Fixtures.History();
        TxnView t = history.add(1, 1, CREDIT, "10", "INR", Fixtures.T0);

        DetectionEngine.Result result = new DetectionEngine(configs).evaluate(Fixtures.ctx(t, history));

        assertThat(result.hits()).containsExactly(hit);
        assertThat(result.failedRules()).containsExactly("BROKEN");
        assertThat(result.degraded()).isTrue();
    }
}
