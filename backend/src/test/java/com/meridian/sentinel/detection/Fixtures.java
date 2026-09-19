package com.meridian.sentinel.detection;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

/** Test fixtures: an in-memory point-in-time history and a fixed reference-data table. */
public final class Fixtures {

    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");
    public static final Instant T0 = Instant.parse("2026-06-15T04:30:00Z"); // 10:00 IST
    public static final BigDecimal USD = new BigDecimal("83.50");

    private Fixtures() {
    }

    public static final class History implements DetectionHistory {
        private final List<TxnView> txns = new ArrayList<>();
        private final AtomicLong ids = new AtomicLong(1);

        public TxnView add(long accountId, long customerId, TxnView.Direction dir, String amount, String currency,
                           Instant at) {
            return add(accountId, customerId, dir, amount, currency, at, null, "IN", "NEFT");
        }

        public TxnView add(long accountId, long customerId, TxnView.Direction dir, String amount, String currency,
                           Instant at, String counterpartyName, String counterpartyCountry, String channel) {
            BigDecimal amt = new BigDecimal(amount);
            BigDecimal base = "USD".equals(currency) ? amt.multiply(USD) : amt;
            long id = ids.getAndIncrement();
            TxnView t = new TxnView(id, "T" + id, accountId, customerId, dir, amt, currency, base, counterpartyName,
                    counterpartyCountry, channel, counterpartyCountry, at);
            txns.add(t);
            return t;
        }

        private boolean upTo(TxnView t, TxnView asOf) {
            return t.occurredAt().isBefore(asOf.occurredAt())
                    || (t.occurredAt().equals(asOf.occurredAt()) && t.id() <= asOf.id());
        }

        @Override
        public List<TxnView> accountHistory(TxnView asOf, Duration lookback) {
            Instant from = asOf.occurredAt().minus(lookback);
            return txns.stream()
                    .filter(t -> t.accountId() == asOf.accountId() && !t.occurredAt().isBefore(from) && upTo(t, asOf))
                    .sorted(Comparator.comparing(TxnView::occurredAt).thenComparingLong(TxnView::id))
                    .toList();
        }

        @Override
        public List<TxnView> customerHistorySince(TxnView asOf, Instant from) {
            return txns.stream()
                    .filter(t -> t.customerId() == asOf.customerId() && !t.occurredAt().isBefore(from) && upTo(t, asOf))
                    .sorted(Comparator.comparing(TxnView::occurredAt).thenComparingLong(TxnView::id))
                    .toList();
        }

        @Override
        public Baseline customerBaseline(long customerId, Instant from, Instant toExclusive) {
            List<TxnView> before = txns.stream()
                    .filter(t -> t.customerId() == customerId && t.occurredAt().isBefore(toExclusive)).toList();
            List<TxnView> window = before.stream().filter(t -> !t.occurredAt().isBefore(from)).toList();
            return new Baseline(window.stream().map(TxnView::amountBase).reduce(BigDecimal.ZERO, BigDecimal::add),
                    window.size(), before.stream().map(TxnView::occurredAt).min(Comparator.naturalOrder()).orElse(null));
        }
    }

    public static final class Reference implements ReferenceData {
        private final Map<String, WatchlistHit> countries;
        private final Map<String, WatchlistHit> parties;

        public Reference() {
            this(Map.of("IR", new WatchlistHit("COUNTRY", "IR", "FATF_BLACKLIST")),
                    Map.of("ORION SHELL HOLDINGS LTD", new WatchlistHit("COUNTERPARTY", "ORION SHELL HOLDINGS LTD", "INTERNAL_WATCHLIST")));
        }

        public Reference(Map<String, WatchlistHit> countries, Map<String, WatchlistHit> parties) {
            this.countries = countries;
            this.parties = parties;
        }

        @Override
        public String baseCurrency() {
            return "INR";
        }

        @Override
        public BigDecimal toBase(BigDecimal amount, String currency) {
            return switch (currency) {
                case "INR" -> amount;
                case "USD" -> amount.multiply(USD);
                default -> throw new IllegalArgumentException("unsupported " + currency);
            };
        }

        @Override
        public Optional<WatchlistHit> matchCountry(String isoCountry) {
            return Optional.ofNullable(isoCountry == null ? null : countries.get(isoCountry));
        }

        @Override
        public Optional<WatchlistHit> matchCounterparty(String name) {
            return Optional.ofNullable(name == null ? null : parties.get(name.trim().toUpperCase()));
        }
    }

    public static RuleContext ctx(TxnView txn, History history) {
        return new RuleContext(txn, history, new Reference(), ZONE);
    }
}
