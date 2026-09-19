package com.meridian.sentinel.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.ZoneId;
import java.util.List;

@ConfigurationProperties("sentinel")
public record SentinelProperties(String baseCurrency, String businessZone, Detection detection, Guardrails guardrails,
                                 List<User> users) {

    public ZoneId zone() {
        return ZoneId.of(businessZone);
    }

    public record Detection(int threads, int aggregationWindowHours) {
    }

    /**
     * @param holdScore             outgoing payments whose alert reaches this score get a HOLD verdict
     * @param supervisorCloseScore  alerts at/above this score can only be closed by a SUPERVISOR (four-eyes)
     * @param autoFreezeOnSanctions freeze the account when an outgoing payment matches a named sanctioned party
     * @param redriveAfterMinutes   unevaluated transactions older than this are re-evaluated automatically
     */
    public record Guardrails(int holdScore, int supervisorCloseScore, boolean autoFreezeOnSanctions,
                             int redriveAfterMinutes) {
    }

    public record User(String username, String password, List<String> roles) {
    }
}
