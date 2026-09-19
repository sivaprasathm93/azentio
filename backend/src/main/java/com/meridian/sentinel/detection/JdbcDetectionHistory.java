package com.meridian.sentinel.detection;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * JDBC implementation of point-in-time history. "As of" a transaction means everything strictly before its
 * timestamp plus same-timestamp rows with a lower-or-equal id, giving a total order that is identical whether
 * transactions arrive in one bulk batch or one by one.
 */
@Repository
public class JdbcDetectionHistory implements DetectionHistory {

    static final String COLUMNS = "t.id, t.txn_ref, t.account_id, t.customer_id, t.direction, t.amount, t.currency, "
            + "t.amount_base, t.counterparty_name, t.counterparty_country, t.channel, t.jurisdiction, t.occurred_at";

    public static final RowMapper<TxnView> MAPPER = (rs, i) -> new TxnView(
            rs.getLong("id"),
            rs.getString("txn_ref"),
            rs.getLong("account_id"),
            rs.getLong("customer_id"),
            TxnView.Direction.valueOf(rs.getString("direction")),
            rs.getBigDecimal("amount"),
            rs.getString("currency"),
            rs.getBigDecimal("amount_base"),
            rs.getString("counterparty_name"),
            rs.getString("counterparty_country"),
            rs.getString("channel"),
            rs.getString("jurisdiction"),
            rs.getObject("occurred_at", OffsetDateTime.class).toInstant());

    private final JdbcTemplate jdbc;

    public JdbcDetectionHistory(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public TxnView load(long txnId) {
        List<TxnView> rows = jdbc.query("SELECT " + COLUMNS + " FROM bank_transaction t WHERE t.id = ?", MAPPER, txnId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    @Override
    public List<TxnView> accountHistory(TxnView asOf, Duration lookback) {
        OffsetDateTime at = odt(asOf.occurredAt());
        return jdbc.query("SELECT " + COLUMNS + " FROM bank_transaction t WHERE t.account_id = ? AND t.occurred_at >= ? "
                        + "AND (t.occurred_at < ? OR (t.occurred_at = ? AND t.id <= ?)) ORDER BY t.occurred_at, t.id",
                MAPPER, asOf.accountId(), odt(asOf.occurredAt().minus(lookback)), at, at, asOf.id());
    }

    @Override
    public List<TxnView> customerHistorySince(TxnView asOf, Instant from) {
        OffsetDateTime at = odt(asOf.occurredAt());
        return jdbc.query("SELECT " + COLUMNS + " FROM bank_transaction t WHERE t.customer_id = ? AND t.occurred_at >= ? "
                        + "AND (t.occurred_at < ? OR (t.occurred_at = ? AND t.id <= ?)) ORDER BY t.occurred_at, t.id",
                MAPPER, asOf.customerId(), odt(from), at, at, asOf.id());
    }

    @Override
    public Baseline customerBaseline(long customerId, Instant from, Instant toExclusive) {
        return jdbc.queryForObject("""
                        SELECT COALESCE(SUM(amount_base) FILTER (WHERE occurred_at >= ?), 0) AS total,
                               COUNT(*) FILTER (WHERE occurred_at >= ?)                     AS cnt,
                               MIN(occurred_at)                                              AS first_at
                        FROM bank_transaction WHERE customer_id = ? AND occurred_at < ?""",
                (rs, i) -> {
                    OffsetDateTime first = rs.getObject("first_at", OffsetDateTime.class);
                    BigDecimal total = rs.getBigDecimal("total");
                    return new Baseline(total, rs.getLong("cnt"), first == null ? null : first.toInstant());
                },
                odt(from), odt(from), customerId, odt(toExclusive));
    }

    static OffsetDateTime odt(Instant i) {
        return OffsetDateTime.ofInstant(i, ZoneOffset.UTC);
    }
}
