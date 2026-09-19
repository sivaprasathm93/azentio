package com.meridian.sentinel.alert;

import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.config.SentinelProperties;
import com.meridian.sentinel.detection.CustomerLock;
import com.meridian.sentinel.detection.config.RuleConfigService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

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

class AlertServiceTest {

    private final AlertRepository repo = mock(AlertRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuditService audit = mock(AuditService.class);
    private final CustomerLock lock = mock(CustomerLock.class);
    private AlertService service;
    private Alert alert;

    @BeforeEach
    void setUp() {
        SentinelProperties props = new SentinelProperties("INR", "Asia/Kolkata", new SentinelProperties.Detection(4, 72),
                new SentinelProperties.Guardrails(80, 80, true, 5), List.of());
        service = new AlertService(repo, jdbc, audit, lock, mock(RuleConfigService.class), props);
        alert = new Alert();
        alert.setId(1L);
        alert.setAlertRef("ALT-100001");
        alert.setCustomerId(7L);
        alert.setStatus(AlertStatus.OPEN);
        alert.setRuleDetails(Map.of());
        when(repo.findById(1L)).thenReturn(Optional.of(alert));
        when(jdbc.queryForList(anyString(), eq(Long.class), any())).thenReturn(List.of(7L));
        login("ANALYST");
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static void login(String... roles) {
        String[] authorities = java.util.Arrays.stream(roles).map(r -> "ROLE_" + r).toArray(String[]::new);
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken("asha", "x", authorities));
    }

    @Test
    void closingRecordsDispositionReasonAndAnalystAndIsAudited() {
        Alert closed = service.transition(1L, AlertAction.CLOSE, Disposition.FALSE_POSITIVE, "Salary bonus, verified payslip");

        assertThat(closed.getStatus()).isEqualTo(AlertStatus.CLOSED);
        assertThat(closed.getDisposition()).isEqualTo(Disposition.FALSE_POSITIVE);
        assertThat(closed.getDisposedBy()).isEqualTo("asha");
        assertThat(closed.getDisposedAt()).isNotNull();
        verify(lock).lock(7L);
        verify(audit).record(eq("ALERT"), eq("ALT-100001"), eq("ALERT_CLOSE"), eq("OPEN"), eq("CLOSED"), any());
    }

    @Test
    void closingWithoutDispositionOrReasonIsRejected() {
        assertThatThrownBy(() -> service.transition(1L, AlertAction.CLOSE, null, "some reason"))
                .isInstanceOf(ApiException.class).hasMessageContaining("disposition");
        assertThatThrownBy(() -> service.transition(1L, AlertAction.CLOSE, Disposition.FALSE_POSITIVE, " "))
                .isInstanceOf(ApiException.class).hasMessageContaining("reason");
        assertThat(alert.getStatus()).isEqualTo(AlertStatus.OPEN);
        verify(audit, never()).record(anyString(), any(), anyString(), any(), any(), any());
    }

    @Test
    void criticalAlertsNeedASupervisorToClose() {
        alert.setRiskScore(85);
        assertThatThrownBy(() -> service.transition(1L, AlertAction.CLOSE, Disposition.FALSE_POSITIVE, "looks fine to me"))
                .isInstanceOf(AccessDeniedException.class).hasMessageContaining("supervisor");
        assertThat(alert.getStatus()).isEqualTo(AlertStatus.OPEN);

        login("ANALYST", "SUPERVISOR");
        assertThat(service.transition(1L, AlertAction.CLOSE, Disposition.FALSE_POSITIVE, "verified with RM, documented")
                .getStatus()).isEqualTo(AlertStatus.CLOSED);
    }

    @Test
    void sanctionsAlertsNeedASupervisorToCloseWhateverTheScore() {
        alert.setRiskScore(40);
        alert.setRuleDetails(Map.of("HIGH_RISK_JURISDICTION", new RuleDetail(0.9, 1, 1, 60, "IR wire", "T1")));
        assertThatThrownBy(() -> service.transition(1L, AlertAction.CLOSE, Disposition.FALSE_POSITIVE, "small amount"))
                .isInstanceOf(AccessDeniedException.class).hasMessageContaining("sanctions");
    }

    @Test
    void illegalTransitionIsAConflict() {
        alert.setStatus(AlertStatus.CLOSED);
        assertThatThrownBy(() -> service.transition(1L, AlertAction.START_REVIEW, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void startReviewAssignsTheAnalyst() {
        Alert a = service.transition(1L, AlertAction.START_REVIEW, null, null);
        assertThat(a.getStatus()).isEqualTo(AlertStatus.UNDER_REVIEW);
        assertThat(a.getAssignee()).isEqualTo("asha");
    }

    @Test
    void onlySupervisorsCanReopenAndReopeningKeepsTheOldDispositionInTheAudit() {
        alert.setStatus(AlertStatus.CLOSED);
        alert.setDisposition(Disposition.FALSE_POSITIVE);
        alert.setDisposedBy("bob");
        assertThatThrownBy(() -> service.transition(1L, AlertAction.REOPEN, null, "new information"))
                .isInstanceOf(AccessDeniedException.class);

        login("ANALYST", "SUPERVISOR");
        Alert a = service.transition(1L, AlertAction.REOPEN, null, "new information received");

        assertThat(a.getStatus()).isEqualTo(AlertStatus.UNDER_REVIEW);
        assertThat(a.getDisposition()).isNull();
        verify(audit).record(eq("ALERT"), eq("ALT-100001"), eq("ALERT_REOPEN"), eq("CLOSED"), eq("UNDER_REVIEW"),
                org.mockito.ArgumentMatchers.<Map<String, Object>>argThat(m -> "FALSE_POSITIVE".equals(m.get("previousDisposition"))
                        && "bob".equals(m.get("previousDisposedBy"))));
    }
}
