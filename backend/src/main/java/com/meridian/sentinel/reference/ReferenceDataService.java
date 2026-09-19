package com.meridian.sentinel.reference;

import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.common.CurrentUser;
import com.meridian.sentinel.common.Money;
import com.meridian.sentinel.config.SentinelProperties;
import com.meridian.sentinel.detection.ReferenceData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.annotation.PostConstruct;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * FX table (Business Rule 9) and high-risk/sanctions watchlist (Business Rule 4), cached as immutable
 * snapshots for lock-free reads from detection threads and refreshed on change (and periodically).
 */
@Service
public class ReferenceDataService implements ReferenceData {

    private static final Logger log = LoggerFactory.getLogger(ReferenceDataService.class);

    private final ExchangeRateRepository rateRepository;
    private final WatchlistRepository watchlistRepository;
    private final AuditService auditService;
    private final String baseCurrency;

    /** Maximum FX move accepted without explicit confirmation (10%). */
    static final BigDecimal MAX_UNCONFIRMED_FX_MOVE = new BigDecimal("0.10");

    private volatile Map<String, BigDecimal> rates = Map.of();
    private volatile Map<String, WatchlistHit> countries = Map.of();
    private volatile Map<String, WatchlistHit> counterparties = Map.of();

    public ReferenceDataService(ExchangeRateRepository rateRepository, WatchlistRepository watchlistRepository,
                                AuditService auditService, SentinelProperties props) {
        this.rateRepository = rateRepository;
        this.watchlistRepository = watchlistRepository;
        this.auditService = auditService;
        this.baseCurrency = props.baseCurrency();
    }

    /** Loaded eagerly so rule guardrails (which convert USD floors) can run during startup. */
    @PostConstruct
    @Scheduled(fixedDelayString = "${sentinel.rules.refresh-ms:30000}", initialDelayString = "${sentinel.rules.refresh-ms:30000}")
    public void refresh() {
        Map<String, BigDecimal> r = new HashMap<>();
        rateRepository.findAll().forEach(x -> r.put(x.getCurrency(), x.getRateToBase()));
        Map<String, WatchlistHit> c = new HashMap<>();
        Map<String, WatchlistHit> p = new HashMap<>();
        for (WatchlistEntry e : watchlistRepository.findAll()) {
            if (!e.isActive()) {
                continue;
            }
            WatchlistHit hit = new WatchlistHit(e.getEntryType(), e.getValue(), e.getListName());
            if ("COUNTRY".equals(e.getEntryType())) {
                c.put(e.getValue(), hit);
            } else {
                p.put(normalise(e.getValue()), hit);
            }
        }
        rates = Map.copyOf(r);
        countries = Map.copyOf(c);
        counterparties = Map.copyOf(p);
        log.debug("Reference data refreshed: {} FX rates, {} countries, {} counterparties", r.size(), c.size(), p.size());
    }

    @Override
    public String baseCurrency() {
        return baseCurrency;
    }

    public boolean isSupportedCurrency(String currency) {
        return currency != null && rates.containsKey(currency);
    }

    @Override
    public BigDecimal toBase(BigDecimal amount, String currency) {
        BigDecimal rate = rates.get(currency);
        if (rate == null) {
            throw ApiException.unprocessable("UNSUPPORTED_CURRENCY", "No exchange rate configured for " + currency);
        }
        return Money.scale(amount.multiply(rate));
    }

    @Override
    public Optional<WatchlistHit> matchCountry(String isoCountry) {
        return isoCountry == null ? Optional.empty() : Optional.ofNullable(countries.get(isoCountry.toUpperCase(Locale.ROOT)));
    }

    @Override
    public Optional<WatchlistHit> matchCounterparty(String name) {
        return name == null ? Optional.empty() : Optional.ofNullable(counterparties.get(normalise(name)));
    }

    public List<ExchangeRate> rates() {
        return rateRepository.findAll();
    }

    @Transactional
    public ExchangeRate upsertRate(String currency, BigDecimal rate, boolean confirmLargeChange) {
        if (rate == null || rate.signum() <= 0) {
            throw ApiException.unprocessable("INVALID_RATE", "rateToBase must be positive");
        }
        ExchangeRate fx = rateRepository.findById(currency).orElseGet(() -> {
            ExchangeRate n = new ExchangeRate();
            n.setCurrency(currency);
            return n;
        });
        String before = fx.getRateToBase() == null ? null : fx.getRateToBase().toPlainString();
        if (baseCurrency.equals(currency) && rate.compareTo(BigDecimal.ONE) != 0) {
            throw ApiException.unprocessable("INVALID_RATE", "Base currency rate must be 1");
        }
        // Guardrail: a fat-fingered rate (e.g. 0.835 instead of 83.5) would shrink every foreign amount 100x and
        // silently push real CTR/structuring cases below threshold. Large moves need an explicit confirmation.
        if (fx.getRateToBase() != null) {
            BigDecimal deviation = rate.subtract(fx.getRateToBase()).abs()
                    .divide(fx.getRateToBase(), 6, java.math.RoundingMode.HALF_UP);
            if (deviation.compareTo(MAX_UNCONFIRMED_FX_MOVE) > 0 && !confirmLargeChange) {
                throw ApiException.unprocessable("FX_RATE_DEVIATION", String.format(
                        "New %s rate %s moves %.1f%% from %s (limit %.0f%%); resend with confirmLargeChange=true if intended",
                        currency, rate.toPlainString(), deviation.doubleValue() * 100, before,
                        MAX_UNCONFIRMED_FX_MOVE.doubleValue() * 100));
            }
        }
        fx.setRateToBase(rate);
        fx.setUpdatedAt(Instant.now());
        fx.setUpdatedBy(CurrentUser.name());
        rateRepository.save(fx);
        auditService.record("FX_RATE", currency, "FX_RATE_SET", before, rate.toPlainString(),
                Map.of("confirmedLargeChange", confirmLargeChange));
        refreshAfterCommit();
        return fx;
    }

    public List<WatchlistEntry> watchlist() {
        return watchlistRepository.findAllByOrderByEntryTypeAscValueAsc();
    }

    @Transactional
    public WatchlistEntry addWatchlistEntry(String type, String value, String listName, String reason) {
        String normalisedValue = "COUNTRY".equals(type) ? value.toUpperCase(Locale.ROOT) : normalise(value);
        if (watchlistRepository.findByEntryTypeAndValue(type, normalisedValue).isPresent()) {
            throw ApiException.conflict("DUPLICATE_ENTRY", type + " " + normalisedValue + " is already on the watchlist");
        }
        WatchlistEntry e = new WatchlistEntry();
        e.setEntryType(type);
        e.setValue(normalisedValue);
        e.setListName(listName);
        e.setReason(reason);
        e.setActive(true);
        e.setUpdatedAt(Instant.now());
        watchlistRepository.save(e);
        auditService.record("WATCHLIST", e.getId(), "WATCHLIST_ADDED", null, "ACTIVE",
                Map.of("type", type, "value", normalisedValue, "list", listName));
        refreshAfterCommit();
        return e;
    }

    @Transactional
    public WatchlistEntry setWatchlistActive(long id, boolean active, String reason) {
        WatchlistEntry e = watchlistRepository.findById(id).orElseThrow(() -> ApiException.notFound("Watchlist entry", id));
        if (!active && (reason == null || reason.trim().length() < 10)) {
            // Removing a sanctions entry stops alerts for that party: always justify it.
            throw ApiException.unprocessable("REASON_REQUIRED", "Deactivating a watchlist entry requires a reason (min 10 chars)");
        }
        String from = e.isActive() ? "ACTIVE" : "INACTIVE";
        e.setActive(active);
        e.setUpdatedAt(Instant.now());
        auditService.record("WATCHLIST", id, active ? "WATCHLIST_ACTIVATED" : "WATCHLIST_DEACTIVATED", from,
                active ? "ACTIVE" : "INACTIVE", Map.of("type", e.getEntryType(), "value", e.getValue(),
                        "reason", reason == null ? "" : reason));
        refreshAfterCommit();
        return e;
    }

    private void refreshAfterCommit() {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                refresh();
            }
        });
    }

    static String normalise(String name) {
        return name.trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
    }
}
