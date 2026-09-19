package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.common.Money;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.util.List;
import java.util.Optional;

/** Business Rule 1: any single transaction at or above the CTR threshold (currency-adjusted) is flagged. */
@Component
public class CtrThresholdRule implements DetectionRule<CtrThresholdRule.Params> {

    public static final String CODE = "CTR_THRESHOLD";

    public record Params(@NotNull @Positive BigDecimal thresholdAmount, @NotBlank String thresholdCurrency) {
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public Class<Params> paramsType() {
        return Params.class;
    }

    @Override
    public Optional<RuleHit> evaluate(RuleContext ctx, Params p) {
        TxnView t = ctx.txn();
        BigDecimal threshold = ctx.reference().toBase(p.thresholdAmount(), p.thresholdCurrency());
        if (t.amountBase().compareTo(threshold) < 0) {
            return Optional.empty();
        }
        double ratio = t.amountBase().divide(threshold, MathContext.DECIMAL64).doubleValue();
        double severity = 0.6 + Math.min(0.4, (ratio - 1.0) * 0.2);

        String base = ctx.reference().baseCurrency();
        String amount = t.currency().equals(base)
                ? Money.fmt(t.amountBase(), base)
                : Money.fmt(t.amount(), t.currency()) + " (" + Money.fmt(t.amountBase(), base) + ")";
        String explanation = String.format(
                "Single %s of %s via %s is at or above the reporting threshold of %s (%s); %.1fx the threshold.",
                t.direction().name().toLowerCase(), amount, t.channel(), Money.fmt(threshold, base),
                Money.fmt(p.thresholdAmount(), p.thresholdCurrency()), ratio);
        return Optional.of(new RuleHit(CODE, severity, List.of(t.id()), explanation));
    }
}
