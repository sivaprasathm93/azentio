package com.meridian.sentinel.alert;

import com.meridian.sentinel.alert.AlertViews.AlertDetail;
import com.meridian.sentinel.alert.AlertViews.AlertSummary;
import com.meridian.sentinel.alert.AlertViews.EvidenceTxn;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.common.PageResponse;
import com.meridian.sentinel.common.PiiMasker;
import com.meridian.sentinel.customer.PiiAccessService;
import com.meridian.sentinel.detection.RiskScorer;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Array;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** Read side for the analyst queue. List views always mask PII. */
@Service
public class AlertQueryService {

    private static final Map<String, String> SORTS = Map.of(
            "riskScore", "a.risk_score", "createdAt", "a.created_at", "updatedAt", "a.updated_at", "windowEnd", "a.window_end");

    static final String SUMMARY_SQL = """
            SELECT a.id, a.alert_ref, a.customer_id, c.external_ref, c.full_name, c.kyc_risk_rating, a.status, a.risk_score,
                   a.rule_codes, a.hit_count, a.window_start, a.window_end, a.assignee, a.case_id, a.created_at, a.updated_at
            FROM alert a JOIN customer c ON c.id = a.customer_id""";

    static final RowMapper<AlertSummary> SUMMARY = (rs, i) -> new AlertSummary(
            rs.getLong("id"), rs.getString("alert_ref"), rs.getLong("customer_id"), rs.getString("external_ref"),
            PiiMasker.maskName(rs.getString("full_name")), rs.getString("kyc_risk_rating"), rs.getString("status"),
            rs.getInt("risk_score"), RiskScorer.band(rs.getInt("risk_score")), strings(rs.getArray("rule_codes")),
            rs.getInt("hit_count"), instant(rs.getObject("window_start", OffsetDateTime.class)),
            instant(rs.getObject("window_end", OffsetDateTime.class)), rs.getString("assignee"),
            (Long) rs.getObject("case_id"), instant(rs.getObject("created_at", OffsetDateTime.class)),
            instant(rs.getObject("updated_at", OffsetDateTime.class)));

    private final NamedParameterJdbcTemplate jdbc;
    private final AlertService alertService;
    private final PiiAccessService piiAccess;

    public AlertQueryService(NamedParameterJdbcTemplate jdbc, AlertService alertService, PiiAccessService piiAccess) {
        this.jdbc = jdbc;
        this.alertService = alertService;
        this.piiAccess = piiAccess;
    }

    public record Filter(List<AlertStatus> statuses, Integer minScore, String ruleCode, Long customerId, String assignee) {
    }

    public PageResponse<AlertSummary> list(Filter f, int page, int size, String sort, String direction) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        MapSqlParameterSource p = new MapSqlParameterSource();
        if (f.statuses() != null && !f.statuses().isEmpty()) {
            where.append(" AND a.status IN (:statuses)");
            p.addValue("statuses", f.statuses().stream().map(Enum::name).toList());
        }
        if (f.minScore() != null) {
            where.append(" AND a.risk_score >= :minScore");
            p.addValue("minScore", f.minScore());
        }
        if (f.ruleCode() != null) {
            where.append(" AND :rule = ANY (a.rule_codes)");
            p.addValue("rule", f.ruleCode());
        }
        if (f.customerId() != null) {
            where.append(" AND a.customer_id = :customerId");
            p.addValue("customerId", f.customerId());
        }
        if (f.assignee() != null) {
            where.append(" AND a.assignee = :assignee");
            p.addValue("assignee", f.assignee());
        }
        String column = SORTS.get(sort);
        if (column == null) {
            throw ApiException.badRequest("BAD_SORT", "sort must be one of " + SORTS.keySet());
        }
        String dir = "asc".equalsIgnoreCase(direction) ? "ASC" : "DESC";
        long total = jdbc.queryForObject("SELECT COUNT(*) FROM alert a" + where, p, Long.class);
        p.addValue("limit", size).addValue("offset", (long) page * size);
        List<AlertSummary> rows = jdbc.query(SUMMARY_SQL + where + " ORDER BY " + column + " " + dir
                + ", a.created_at DESC, a.id DESC LIMIT :limit OFFSET :offset", p, SUMMARY);
        return PageResponse.of(rows, page, size, total);
    }

    public List<AlertSummary> byCase(long caseId) {
        return jdbc.query(SUMMARY_SQL + " WHERE a.case_id = :caseId ORDER BY a.risk_score DESC",
                Map.of("caseId", caseId), SUMMARY);
    }

    public AlertDetail detail(long id) {
        Alert a = alertService.get(id);
        AlertSummary summary = jdbc.query(SUMMARY_SQL + " WHERE a.id = :id", Map.of("id", id), SUMMARY).get(0);
        List<EvidenceTxn> evidence = jdbc.query("""
                        SELECT t.id, t.txn_ref, acc.account_number, t.direction, t.amount, t.currency, t.amount_base,
                               t.counterparty_name, t.counterparty_country, t.channel, t.jurisdiction, t.occurred_at,
                               array_agg(e.rule_code ORDER BY e.rule_code) AS rules
                        FROM alert_evidence e
                        JOIN bank_transaction t ON t.id = e.transaction_id
                        JOIN account acc ON acc.id = t.account_id
                        WHERE e.alert_id = :id
                        GROUP BY t.id, acc.account_number
                        ORDER BY t.occurred_at, t.id""",
                Map.of("id", id), (rs, i) -> new EvidenceTxn(rs.getLong("id"), rs.getString("txn_ref"),
                        rs.getString("account_number"), rs.getString("direction"), rs.getBigDecimal("amount"),
                        rs.getString("currency"), rs.getBigDecimal("amount_base"), rs.getString("counterparty_name"),
                        rs.getString("counterparty_country"), rs.getString("channel"), rs.getString("jurisdiction"),
                        instant(rs.getObject("occurred_at", OffsetDateTime.class)), strings(rs.getArray("rules"))));
        String caseRef = a.getCaseId() == null ? null : jdbc.queryForObject(
                "SELECT case_ref FROM aml_case WHERE id = :id", Map.of("id", a.getCaseId()), String.class);
        return new AlertDetail(summary, a.getExplanation(), a.getRuleDetails(),
                a.getDisposition() == null ? null : a.getDisposition().name(), a.getDispositionReason(),
                a.getDisposedBy(), a.getDisposedAt(), caseRef,
                piiAccess.detailView(a.getCustomerId(), "alert " + a.getAlertRef()), evidence);
    }

    static List<String> strings(Array array) throws SQLException {
        if (array == null) {
            return List.of();
        }
        return new ArrayList<>(Arrays.asList((String[]) array.getArray()));
    }

    static Instant instant(OffsetDateTime odt) {
        return odt == null ? null : odt.toInstant();
    }
}
