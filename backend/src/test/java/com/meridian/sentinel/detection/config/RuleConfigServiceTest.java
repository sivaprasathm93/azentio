package com.meridian.sentinel.detection.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.detection.Fixtures;
import com.meridian.sentinel.detection.rules.CtrThresholdRule;
import com.meridian.sentinel.detection.rules.StructuringRule;
import jakarta.validation.Validation;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RuleConfigServiceTest {

    private final RuleConfigRepository repo = mock(RuleConfigRepository.class);
    private final RuleConfigHistoryRepository historyRepo = mock(RuleConfigHistoryRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private RuleConfigService service;

    @BeforeEach
    void setUp() {
        service = new RuleConfigService(repo, historyRepo, audit, Validation.buildDefaultValidatorFactory().getValidator(),
                new ObjectMapper().registerModule(new JavaTimeModule()), List.of(new CtrThresholdRule(), new StructuringRule()),
                new RuleGuardrails(), new Fixtures.Reference());
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    private static RuleConfig cfg(String code, boolean enabled, Map<String, Object> params) {
        RuleConfig c = new RuleConfig();
        c.setRuleCode(code);
        c.setEnabled(enabled);
        c.setWeight(40);
        c.setVersion(1);
        c.setParams(new HashMap<>(params));
        return c;
    }

    private static Map<String, Object> structuringParams() {
        return Map.of("lowerAmount", 9000, "upperAmount", 9999.99, "currency", "USD", "minCount", 3, "windowHours", 24);
    }

    @Test
    void refreshBindsTypedParams() {
        when(repo.findAllByOrderByRuleCode()).thenReturn(List.of(
                cfg("CTR_THRESHOLD", false, Map.of("thresholdAmount", 10000, "thresholdCurrency", "USD")),
                cfg("STRUCTURING", true, structuringParams())));

        service.refresh();

        // CTR is mandated: even though the row says disabled, the guardrail keeps it running
        assertThat(service.activeRules()).extracting(ActiveRule::code).containsExactlyInAnyOrder("STRUCTURING", "CTR_THRESHOLD");
        StructuringRule.Params p = (StructuringRule.Params) service.snapshot().get("STRUCTURING").params();
        assertThat(p.minCount()).isEqualTo(3);
        assertThat(p.upperAmount()).isEqualByComparingTo(new BigDecimal("9999.99"));
    }

    @Test
    void ruleWithCorruptParamsIsSkippedInsteadOfBreakingDetection() {
        when(repo.findAllByOrderByRuleCode()).thenReturn(List.of(
                cfg("STRUCTURING", true, Map.of("minCount", "lots")),
                cfg("CTR_THRESHOLD", true, Map.of("thresholdAmount", 10000, "thresholdCurrency", "USD"))));

        service.refresh();

        assertThat(service.activeRules()).extracting(ActiveRule::code).containsExactly("CTR_THRESHOLD");
    }

    @Test
    void updateMergesParamsBumpsVersionAndWritesHistoryAndAudit() {
        RuleConfig existing = cfg("STRUCTURING", true, structuringParams());
        when(repo.findById("STRUCTURING")).thenReturn(Optional.of(existing));

        RuleConfig updated = service.update("STRUCTURING", null, 50, Map.of("minCount", 2, "windowHours", 48));

        assertThat(updated.getVersion()).isEqualTo(2);
        assertThat(updated.getWeight()).isEqualTo(50);
        assertThat(updated.getParams()).containsEntry("minCount", 2).containsEntry("windowHours", 48)
                .containsEntry("currency", "USD");
        verify(historyRepo).save(any(RuleConfigHistory.class));
        verify(audit).record(eq("RULE"), eq("STRUCTURING"), eq("RULE_CONFIG_UPDATED"), eq("v1"), eq("v2"), any());
    }

    @Test
    void invalidTuningIsRejectedWith422AndNothingIsPersisted() {
        when(repo.findById("STRUCTURING")).thenReturn(Optional.of(cfg("STRUCTURING", true, structuringParams())));

        assertThatThrownBy(() -> service.update("STRUCTURING", null, null, Map.of("minCount", 1)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY))
                .hasMessageContaining("minCount");
        assertThatThrownBy(() -> service.update("STRUCTURING", null, null, Map.of("typo", 1)))
                .isInstanceOf(ApiException.class);
        verify(repo, never()).save(any());
        verify(audit, never()).record(anyString(), any(), anyString(), any(), any(), any());
    }

    @Test
    void guardrailsRejectLooseningOrDisablingAMandatedRule() {
        when(repo.findById("STRUCTURING")).thenReturn(Optional.of(cfg("STRUCTURING", true, structuringParams())));

        assertThatThrownBy(() -> service.update("STRUCTURING", false, null, null))
                .isInstanceOf(ApiException.class).hasMessageContaining("cannot be disabled")
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("GUARDRAIL_VIOLATION"));
        assertThatThrownBy(() -> service.update("STRUCTURING", null, null, Map.of("minCount", 5, "windowHours", 12)))
                .isInstanceOf(ApiException.class).hasMessageContaining("minCount").hasMessageContaining("window");
        assertThatThrownBy(() -> service.update("STRUCTURING", null, 0, null))
                .isInstanceOf(ApiException.class).hasMessageContaining("weight");
        verify(repo, never()).save(any());
    }

    @Test
    void mandatedRuleDisabledDirectlyInTheDatabaseKeepsRunning() {
        when(repo.findAllByOrderByRuleCode()).thenReturn(List.of(
                cfg("CTR_THRESHOLD", false, Map.of("thresholdAmount", 10000, "thresholdCurrency", "USD"))));

        service.refresh();

        assertThat(service.activeRules()).extracting(ActiveRule::code).containsExactly("CTR_THRESHOLD");
    }

    @Test
    void unknownRuleIs404() {
        when(repo.findById("NOPE")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.update("NOPE", true, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }
}
