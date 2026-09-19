package com.meridian.sentinel.detection;

import java.math.BigDecimal;
import java.util.Optional;

/** Configurable reference data consulted by rules (FX table and high-risk / sanctions watchlist). */
public interface ReferenceData {

    String baseCurrency();

    /** Converts an amount to the base currency (INR) using the configurable exchange-rate table. */
    BigDecimal toBase(BigDecimal amount, String currency);

    Optional<WatchlistHit> matchCountry(String isoCountry);

    Optional<WatchlistHit> matchCounterparty(String name);

    record WatchlistHit(String type, String value, String listName) {
    }
}
