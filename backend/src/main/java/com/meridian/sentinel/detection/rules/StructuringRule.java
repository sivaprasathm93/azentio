package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.common.Money;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Business Rule 2: {@code minCount}+ transactions on one account within {@code windowHours}, each in the
 * just-below-threshold band [{@code lowerAmount}, {@code upperAmount}] (default USD 9,000–9,999.99, 3 in 24h).
 */
@Component
public class StructuringRule implements DetectionRule<StructuringRule.Params> {

    public static final String CODE = "STRUCTURING";

    public record Params(@NotNull @Positive BigDecimal lowerAmount, @NotNull @Positive BigDecimal upperAmount,
                         @NotBlank String currency, @Min(2) int minCount, @Min(1) int windowHours) {
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
        BigDecimal lower = ctx.reference().toBase(p.lowerAmount(), p.currency());
        BigDecimal upper = ctx.reference().toBase(p.upperAmount(), p.currency());
        // Only the transaction that completes (or extends) the pattern raises the hit.
        if (!inBand(ctx.txn(), lower, upper)) {
            return Optional.empty();
        }
        List<TxnView> band = ctx.history().accountHistory(ctx.txn(), Duration.ofHours(p.windowHours())).stream()
                .filter(t -> inBand(t, lower, upper))
                .toList();
        if (band.size() < p.minCount()) {
            return Optional.empty();
        }
        String base = ctx.reference().baseCurrency();
        BigDecimal total = band.stream().map(TxnView::amountBase).reduce(BigDecimal.ZERO, BigDecimal::add);
        String amounts = band.stream().map(t -> Money.fmt(t.amount(), t.currency())).collect(Collectors.joining(", "));
        String explanation = String.format(
                "%d transactions on one account within %dh each fall just below the reporting threshold "
                        + "(band %s–%s, i.e. %s–%s): %s. Combined value %s.",
                band.size(), p.windowHours(), Money.fmt(p.lowerAmount(), p.currency()), Money.fmt(p.upperAmount(), p.currency()),
                Money.fmt(lower, base), Money.fmt(upper, base), amounts, Money.fmt(total, base));
        double severity = 0.7 + 0.1 * (band.size() - p.minCount());
        return Optional.of(new RuleHit(CODE, severity, band.stream().map(TxnView::id).toList(), explanation));
    }

    private static boolean inBand(TxnView t, BigDecimal lower, BigDecimal upper) {
        return t.amountBase().compareTo(lower) >= 0 && t.amountBase().compareTo(upper) <= 0;
    }
}
