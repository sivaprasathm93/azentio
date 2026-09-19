package com.meridian.sentinel.dashboard;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/dashboard")
@Tag(name = "Dashboard", description = "Queue health, risk heatmap and analyst productivity metrics")
@PreAuthorize("hasRole('ANALYST')")
public class DashboardController {

    private final JdbcTemplate jdbc;

    public DashboardController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/summary")
    @Operation(summary = "Counts by status, rule x risk-band heatmap, 30-day trend and disposition metrics")
    public Map<String, Object> summary() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("alertsByStatus", jdbc.queryForList("SELECT status, COUNT(*) AS count FROM alert GROUP BY status ORDER BY status"));
        out.put("heatmap", jdbc.queryForList("""
                SELECT r.rule_code, CASE WHEN a.risk_score >= 80 THEN 'CRITICAL' WHEN a.risk_score >= 60 THEN 'HIGH'
                                         WHEN a.risk_score >= 40 THEN 'MEDIUM' ELSE 'LOW' END AS band,
                       COUNT(*) AS count
                FROM alert a CROSS JOIN LATERAL unnest(a.rule_codes) AS r(rule_code)
                WHERE a.status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
                GROUP BY 1, 2 ORDER BY 1, 2"""));
        out.put("dailyAlerts", jdbc.queryForList("""
                SELECT to_char(date_trunc('day', window_end), 'YYYY-MM-DD') AS day, COUNT(*) AS count
                FROM alert WHERE window_end >= (SELECT MAX(window_end) FROM alert) - interval '30 days'
                GROUP BY 1 ORDER BY 1"""));
        out.put("dispositions", jdbc.queryForList(
                "SELECT disposition, COUNT(*) AS count FROM alert WHERE status = 'CLOSED' GROUP BY disposition ORDER BY disposition"));
        out.put("metrics", jdbc.queryForMap("""
                SELECT COUNT(*) FILTER (WHERE status IN ('OPEN', 'UNDER_REVIEW'))               AS open_queue,
                       COUNT(*) FILTER (WHERE status IN ('OPEN', 'UNDER_REVIEW') AND risk_score >= 80) AS critical_open,
                       ROUND(AVG(EXTRACT(EPOCH FROM (disposed_at - created_at)) / 3600)
                             FILTER (WHERE disposed_at IS NOT NULL)::numeric, 2)                     AS avg_hours_to_disposition,
                       ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'FALSE_POSITIVE')
                             / NULLIF(COUNT(*) FILTER (WHERE status = 'CLOSED'), 0), 1)              AS false_positive_rate_pct,
                       (SELECT COUNT(*) FROM aml_case WHERE status <> 'CLOSED')                     AS open_cases,
                       (SELECT COUNT(*) FROM bank_transaction)                                      AS transactions,
                       (SELECT COUNT(*) FROM bank_transaction WHERE evaluated_at IS NULL)           AS pending_evaluation
                FROM alert"""));
        List<Map<String, Object>> top = jdbc.queryForList("""
                SELECT a.customer_id, c.external_ref, COUNT(*) AS open_alerts, MAX(a.risk_score) AS max_score
                FROM alert a JOIN customer c ON c.id = a.customer_id
                WHERE a.status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
                GROUP BY a.customer_id, c.external_ref ORDER BY max_score DESC, open_alerts DESC LIMIT 10""");
        out.put("topCustomers", top);
        return out;
    }
}
