package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.common.Money;
import com.meridian.sentinel.detection.DetectionHistory.Baseline;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
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
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Business Rule 5: a customer's value (or count) for the current business day exceeds {@code multiplier}x
 * (default 3x) their rolling {@code lookbackDays} (default 90) daily average.
 * <p>
 * Guards against noise: the customer needs {@code minHistoryDays} of history, and the day must be material
 * ({@code minDailyAmount} / {@code minDailyCount}). An old customer with no activity in the whole lookback
 * window who suddenly moves a material amount (dormant-account reactivation) also fires.
 */
@Component
public class BehavioralDeviationRule implements DetectionRule<BehavioralDeviationRule.Params> {

    public static final String CODE = "BEHAVIORAL_DEVIATION";

    public record Params(@NotNull @DecimalMin("1.0") BigDecimal multiplier, @Min(7) int lookbackDays,
                         @Min(1) int minHistoryDays, @NotNull @PositiveOrZero BigDecimal minDailyAmount,
                         @Min(1) int minDailyCount, @NotBlank String currency) {
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
        Instant dayStart = t.occurredAt().atZone(ctx.zone()).toLocalDate().atStartOfDay(ctx.zone()).toInstant();
        List<TxnView> today = ctx.history().customerHistorySince(t, dayStart);
        BigDecimal todayValue = today.stream().map(TxnView::amountBase).reduce(BigDecimal.ZERO, BigDecimal::add);
        int todayCount = today.size();

        BigDecimal minDaily = ctx.reference().toBase(p.minDailyAmount(), p.currency());
        boolean materialValue = todayValue.compareTo(minDaily) >= 0;
        boolean materialCount = todayCount >= p.minDailyCount();
        if (!materialValue && !materialCount) {
            return Optional.empty();
        }

        Instant lookbackStart = dayStart.minus(p.lookbackDays(), ChronoUnit.DAYS);
        Baseline baseline = ctx.history().customerBaseline(t.customerId(), lookbackStart, dayStart);
        if (baseline.firstTxnAt() == null) {
            return Optional.empty(); // brand-new customer: no behaviour to deviate from
        }
        long historyDays = Duration.between(baseline.firstTxnAt(), dayStart).toDays();
        if (historyDays < p.minHistoryDays()) {
            return Optional.empty();
        }
        long divisor = Math.max(1, Math.min(p.lookbackDays(), historyDays));
        BigDecimal avgValue = baseline.totalBase().divide(BigDecimal.valueOf(divisor), MathContext.DECIMAL64);
        double avgCount = (double) baseline.txnCount() / divisor;
        String base = ctx.reference().baseCurrency();
        double multiplier = p.multiplier().doubleValue();

        List<String> reasons = new ArrayList<>();
        double ratio = 0;
        if (materialValue) {
            if (avgValue.signum() == 0) {
                reasons.add(String.format("%s moved today after no activity in the previous %d days (dormant reactivation)",
                        Money.fmt(todayValue, base), p.lookbackDays()));
                ratio = Double.POSITIVE_INFINITY;
            } else {
                double valueRatio = todayValue.divide(avgValue, MathContext.DECIMAL64).doubleValue();
                if (valueRatio > multiplier) {
                    reasons.add(String.format("daily value %s is %.1fx the %d-day average of %s/day",
                            Money.fmt(todayValue, base), valueRatio, divisor, Money.fmt(avgValue, base)));
                    ratio = Math.max(ratio, valueRatio);
                }
            }
        }
        if (materialCount && avgCount > 0) {
            double countRatio = todayCount / avgCount;
            if (countRatio > multiplier) {
                reasons.add(String.format("%d transactions today is %.1fx the %d-day average of %.2f/day",
                        todayCount, countRatio, divisor, avgCount));
                ratio = Math.max(ratio, countRatio);
            }
        }
        if (reasons.isEmpty()) {
            return Optional.empty();
        }
        double severity = 0.5 + Math.min(0.5, (ratio / multiplier - 1.0) * 0.25);
        String explanation = "Behavioural deviation: " + String.join("; ", reasons)
                + String.format(" (threshold %.1fx).", multiplier);
        return Optional.of(new RuleHit(CODE, severity, today.stream().map(TxnView::id).toList(), explanation));
    }
}
