package com.meridian.sentinel.detection;

import com.meridian.sentinel.detection.PaymentDecisionPolicy.Decision;
import com.meridian.sentinel.detection.PaymentDecisionPolicy.Result;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.meridian.sentinel.detection.TxnView.Direction.CREDIT;
import static com.meridian.sentinel.detection.TxnView.Direction.DEBIT;
import static org.assertj.core.api.Assertions.assertThat;

class PaymentDecisionPolicyTest {

    private final Fixtures.History history = new Fixtures.History();
    private final TxnView debit = history.add(1, 1, DEBIT, "500000", "INR", Fixtures.T0);
    private final TxnView credit = history.add(1, 1, CREDIT, "500000", "INR", Fixtures.T0);

    private static RuleHit hit(String code, double severity) {
        return new RuleHit(code, severity, List.of(1L), code);
    }

    @Test
    void cleanTransactionIsAllowed() {
        assertThat(PaymentDecisionPolicy.decide(debit, "ACTIVE", List.of(), null, List.of(), 80).decision())
                .isEqualTo(Decision.ALLOW);
    }

    @Test
    void lowRiskAlertIsReviewedButNotHeld() {
        Result r = PaymentDecisionPolicy.decide(debit, "ACTIVE", List.of(hit("CTR_THRESHOLD", 0.6)), 18, List.of(), 80);
        assertThat(r.decision()).isEqualTo(Decision.REVIEW);
    }

    @Test
    void highScoreOutgoingPaymentIsHeldButIncomingIsOnlyReviewed() {
        List<RuleHit> hits = List.of(hit("STRUCTURING", 1.0), hit("RAPID_MOVEMENT", 1.0));
        assertThat(PaymentDecisionPolicy.decide(debit, "ACTIVE", hits, 95, List.of(), 80).decision()).isEqualTo(Decision.HOLD);
        assertThat(PaymentDecisionPolicy.decide(credit, "ACTIVE", hits, 95, List.of(), 80).decision()).isEqualTo(Decision.REVIEW);
    }

    @Test
    void sanctionedPartyOnOutgoingPaymentHoldsAndFreezes() {
        Result r = PaymentDecisionPolicy.decide(debit, "ACTIVE", List.of(hit("HIGH_RISK_JURISDICTION", 1.0)), 60, List.of(), 80);
        assertThat(r.decision()).isEqualTo(Decision.HOLD);
        assertThat(r.freezeAccount()).isTrue();
    }

    @Test
    void highRiskCountryHoldsInEitherDirectionWithoutFreezing() {
        Result r = PaymentDecisionPolicy.decide(credit, "ACTIVE", List.of(hit("HIGH_RISK_JURISDICTION", 0.9)), 54, List.of(), 80);
        assertThat(r.decision()).isEqualTo(Decision.HOLD);
        assertThat(r.freezeAccount()).isFalse();
    }

    @Test
    void debitsFromAFrozenAccountAreHeldEvenWithoutAlerts() {
        assertThat(PaymentDecisionPolicy.decide(debit, "FROZEN", List.of(), null, List.of(), 80).decision())
                .isEqualTo(Decision.HOLD);
    }

    @Test
    void degradedEvaluationFailsClosed() {
        Result r = PaymentDecisionPolicy.decide(debit, "ACTIVE", List.of(), null, List.of("STRUCTURING"), 80);
        assertThat(r.decision()).isEqualTo(Decision.HOLD);
        assertThat(r.reasons()).anyMatch(s -> s.contains("failing closed"));
    }
}
