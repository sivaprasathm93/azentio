package com.meridian.sentinel.common;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

public final class Money {

    public static final int SCALE = 4;

    private Money() {
    }

    public static BigDecimal scale(BigDecimal value) {
        return value.setScale(SCALE, RoundingMode.HALF_EVEN);
    }

    /** Human-readable amount for alert explanations, e.g. "INR 751,500.00". */
    public static String fmt(BigDecimal amount, String currency) {
        DecimalFormat df = new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(Locale.ROOT));
        return currency + " " + df.format(amount.setScale(2, RoundingMode.HALF_EVEN));
    }
}
