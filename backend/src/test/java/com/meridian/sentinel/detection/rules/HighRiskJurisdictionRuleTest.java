package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.ReferenceData;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static com.meridian.sentinel.detection.Fixtures.T0;
import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static com.meridian.sentinel.detection.TxnView.Direction.DEBIT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HighRiskJurisdictionRuleTest {

    private final HighRiskJurisdictionRule rule = new HighRiskJurisdictionRule();
    private final Fixtures.History history = new Fixtures.History();

    @Test
    void alertsOnHighRiskCounterpartyCountryRegardlessOfAmount() {
        TxnView tiny = history.add(1, 1, DEBIT, "1", "INR", T0, "Some Trader", "IR", "SWIFT");

        RuleHit hit = rule.evaluate(Fixtures.ctx(tiny, history), new HighRiskJurisdictionRule.Params(true)).orElseThrow();

        assertThat(hit.severity()).isEqualTo(0.9);
        assertThat(hit.explanation()).contains("IR", "FATF_BLACKLIST", "Outgoing");
    }

    @Test
    void sanctionedCounterpartyNameMatchesCaseInsensitivelyWithMaxSeverity() {
        TxnView t = history.add(1, 1, CREDIT, "25000", "USD", T0, "  orion shell holdings ltd ", "AE", "SWIFT");

        RuleHit hit = rule.evaluate(Fixtures.ctx(t, history), new HighRiskJurisdictionRule.Params(true)).orElseThrow();

        assertThat(hit.severity()).isEqualTo(1.0);
        assertThat(hit.explanation()).contains("INTERNAL_WATCHLIST");
    }

    @Test
    void counterpartyNameMatchingCanBeSwitchedOff() {
        TxnView t = history.add(1, 1, CREDIT, "25000", "USD", T0, "Orion Shell Holdings Ltd", "AE", "SWIFT");

        assertThat(rule.evaluate(Fixtures.ctx(t, history), new HighRiskJurisdictionRule.Params(false))).isEmpty();
    }

    @Test
    void cleanTransactionDoesNotAlertAndConsultsTheWatchlist() {
        ReferenceData ref = mock(ReferenceData.class);
        when(ref.matchCountry(any())).thenReturn(Optional.empty());
        when(ref.matchCounterparty(any())).thenReturn(Optional.empty());
        TxnView t = history.add(1, 1, DEBIT, "5000", "INR", T0, "Grocer", "IN", "UPI");

        Optional<RuleHit> hit = rule.evaluate(new RuleContext(t, history, ref, Fixtures.ZONE),
                new HighRiskJurisdictionRule.Params(false));

        assertThat(hit).isEmpty();
        verify(ref).matchCountry("IN");
        verify(ref, never()).matchCounterparty(any());
    }
}
