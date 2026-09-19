package com.meridian.sentinel.casemgmt;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CaseStatusTest {

    @Test
    void workflowAllowsOnlyForwardTransitions() {
        assertThat(CaseStatus.OPEN.canMoveTo(CaseStatus.INVESTIGATING)).isTrue();
        assertThat(CaseStatus.INVESTIGATING.canMoveTo(CaseStatus.SAR_FILED)).isTrue();
        assertThat(CaseStatus.SAR_FILED.canMoveTo(CaseStatus.CLOSED)).isTrue();
        assertThat(CaseStatus.OPEN.canMoveTo(CaseStatus.SAR_FILED)).as("must investigate before filing").isFalse();
        assertThat(CaseStatus.SAR_FILED.canMoveTo(CaseStatus.INVESTIGATING)).isFalse();
        for (CaseStatus s : CaseStatus.values()) {
            assertThat(CaseStatus.CLOSED.canMoveTo(s)).as("closed is terminal").isFalse();
        }
    }

    @Test
    void filingAndClosingNeedASupervisor() {
        assertThat(CaseStatus.SAR_FILED.requiresSupervisor()).isTrue();
        assertThat(CaseStatus.CLOSED.requiresSupervisor()).isTrue();
        assertThat(CaseStatus.INVESTIGATING.requiresSupervisor()).isFalse();
    }

    @Test
    void priorityFollowsRiskScore() {
        assertThat(CaseService.priority(92)).isEqualTo("CRITICAL");
        assertThat(CaseService.priority(61)).isEqualTo("HIGH");
        assertThat(CaseService.priority(45)).isEqualTo("MEDIUM");
        assertThat(CaseService.priority(10)).isEqualTo("LOW");
    }
}
