package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.common.Money;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Business Rule 3: funds credited to an account and {@code outflowRatio} (default 80%) or more of that value
 * moved out again within {@code windowHours} (default 48h). Evaluated when an outgoing transaction arrives.
 */
@Component
public class RapidMovementRule implements DetectionRule<RapidMovementRule.Params> {

    public static final String CODE = "RAPID_MOVEMENT";

    public record Params(@Min(1) int windowHours,
                         @NotNull @DecimalMin(value = "0.0", inclusive = false) @DecimalMax("1.0") BigDecimal outflowRatio,
                         @NotNull @PositiveOrZero BigDecimal minInflowAmount, @NotBlank String currency) {
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
        if (ctx.txn().isCredit()) {
            return Optional.empty();
        }
        List<TxnView> window = ctx.history().accountHistory(ctx.txn(), Duration.ofHours(p.windowHours()));
        List<TxnView> credits = window.stream().filter(TxnView::isCredit).toList();
        if (credits.isEmpty()) {
            return Optional.empty();
        }
        Instant firstCredit = credits.get(0).occurredAt();
        List<TxnView> debits = window.stream()
                .filter(t -> !t.isCredit() && !t.occurredAt().isBefore(firstCredit))
                .toList();

        BigDecimal inflow = sum(credits);
        BigDecimal minInflow = ctx.reference().toBase(p.minInflowAmount(), p.currency());
        if (inflow.signum() == 0 || inflow.compareTo(minInflow) < 0) {
            return Optional.empty();
        }
        BigDecimal outflow = sum(debits);
        BigDecimal ratio = outflow.divide(inflow, MathContext.DECIMAL64);
        if (ratio.compareTo(p.outflowRatio()) < 0) {
            return Optional.empty();
        }

        double r = Math.min(1.0, ratio.doubleValue());
        double threshold = p.outflowRatio().doubleValue();
        double severity = threshold >= 1.0 ? 1.0 : 0.6 + 0.4 * (r - threshold) / (1.0 - threshold);

        String base = ctx.reference().baseCurrency();
        long hours = Math.max(1, Duration.between(firstCredit, ctx.txn().occurredAt()).toHours());
        String explanation = String.format(
                "%s credited in %d transaction(s) and %s (%.1f%%) moved out in %d debit(s) within %dh "
                        + "(rule: >= %.0f%% out within %dh).",
                Money.fmt(inflow, base), credits.size(), Money.fmt(outflow, base), ratio.doubleValue() * 100,
                debits.size(), hours, threshold * 100, p.windowHours());

        List<Long> evidence = new ArrayList<>();
        credits.forEach(t -> evidence.add(t.id()));
        debits.forEach(t -> evidence.add(t.id()));
        return Optional.of(new RuleHit(CODE, severity, evidence, explanation));
    }

    private static BigDecimal sum(List<TxnView> txns) {
        return txns.stream().map(TxnView::amountBase).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
