package com.meridian.sentinel.reference;

import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.config.SentinelProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ReferenceDataServiceTest {

    private final ExchangeRateRepository rates = mock(ExchangeRateRepository.class);
    private final WatchlistRepository watchlist = mock(WatchlistRepository.class);
    private ReferenceDataService service;

    @BeforeEach
    void setUp() {
        SentinelProperties props = new SentinelProperties("INR", "Asia/Kolkata", null, null, List.of());
        service = new ReferenceDataService(rates, watchlist, mock(AuditService.class), props);
        ExchangeRate usd = new ExchangeRate();
        usd.setCurrency("USD");
        usd.setRateToBase(new BigDecimal("83.50"));
        when(rates.findById("USD")).thenReturn(Optional.of(usd));
        when(rates.findAll()).thenReturn(List.of(usd));
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void fatFingeredRateIsRejectedUnlessExplicitlyConfirmed() {
        assertThatThrownBy(() -> service.upsertRate("USD", new BigDecimal("0.835"), false))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("FX_RATE_DEVIATION"));
        verify(rates, never()).save(any());

        assertThat(service.upsertRate("USD", new BigDecimal("0.835"), true).getRateToBase()).isEqualByComparingTo("0.835");
    }

    @Test
    void normalDailyMovementIsAccepted() {
        assertThat(service.upsertRate("USD", new BigDecimal("84.10"), false).getRateToBase()).isEqualByComparingTo("84.10");
    }

    @Test
    void normalisesToBaseCurrencyAndRejectsUnknownCurrencies() {
        service.refresh();
        assertThat(service.toBase(new BigDecimal("10000"), "USD")).isEqualByComparingTo("835000");
        assertThatThrownBy(() -> service.toBase(BigDecimal.ONE, "XYZ")).isInstanceOf(ApiException.class);
    }

    @Test
    void deactivatingAWatchlistEntryRequiresAJustification() {
        WatchlistEntry e = new WatchlistEntry();
        e.setId(9L);
        e.setEntryType("COUNTRY");
        e.setValue("IR");
        e.setActive(true);
        when(watchlist.findById(9L)).thenReturn(Optional.of(e));

        assertThatThrownBy(() -> service.setWatchlistActive(9L, false, null)).isInstanceOf(ApiException.class);
        assertThat(service.setWatchlistActive(9L, false, "Delisted by OFAC on 2026-09-01").isActive()).isFalse();
    }
}
