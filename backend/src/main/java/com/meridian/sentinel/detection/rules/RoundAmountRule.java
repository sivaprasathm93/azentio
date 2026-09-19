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
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Repeated suspiciously round amounts: {@code minCount}+ transactions on one account within {@code windowHours}
 * whose original amount is an exact multiple of {@code roundingUnit} and at least {@code minAmount} (equivalent).
 */
@Component
public class RoundAmountRule implements DetectionRule<RoundAmountRule.Params> {

    public static final String CODE = "ROUND_AMOUNT";

    public record Params(@NotNull @Positive BigDecimal roundingUnit, @NotNull @PositiveOrZero BigDecimal minAmount,
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
        BigDecimal minBase = ctx.reference().toBase(p.minAmount(), p.currency());
        if (!isRound(ctx.txn(), p.roundingUnit(), minBase)) {
            return Optional.empty();
        }
        List<TxnView> round = ctx.history().accountHistory(ctx.txn(), Duration.ofHours(p.windowHours())).stream()
                .filter(t -> isRound(t, p.roundingUnit(), minBase))
                .toList();
        if (round.size() < p.minCount()) {
            return Optional.empty();
        }
        String amounts = round.stream().map(t -> Money.fmt(t.amount(), t.currency())).collect(Collectors.joining(", "));
        String explanation = String.format(
                "%d transactions on one account within %dh are exact multiples of %s (each >= %s equivalent): %s.",
                round.size(), p.windowHours(), p.roundingUnit().stripTrailingZeros().toPlainString(),
                Money.fmt(p.minAmount(), p.currency()), amounts);
        double severity = Math.min(0.9, 0.5 + 0.1 * (round.size() - p.minCount()));
        return Optional.of(new RuleHit(CODE, severity, round.stream().map(TxnView::id).toList(), explanation));
    }

    static boolean isRound(TxnView t, BigDecimal unit, BigDecimal minBase) {
        return t.amountBase().compareTo(minBase) >= 0 && t.amount().remainder(unit).signum() == 0;
    }
}
