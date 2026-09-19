package com.meridian.sentinel.detection;

import com.meridian.sentinel.alert.AlertService;
import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.config.SentinelProperties;
import com.meridian.sentinel.customer.RiskRating;
import com.meridian.sentinel.detection.PaymentDecisionPolicy.Decision;
import com.meridian.sentinel.reference.ReferenceDataService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.ZoneId;
import java.util.List;
import java.util.Map;

/**
 * Evaluates one transaction: lock customer -> load point-in-time snapshot -> run rules -> raise/aggregate alert
 * -> decide ALLOW/REVIEW/HOLD -> mark evaluated, all in one database transaction.
 * <p>
 * Idempotent ({@code evaluated_at} guard). If any rule failed the transaction is deliberately left unevaluated so the
 * scheduled re-drive picks it up again, and the verdict is HOLD (fail closed).
 */
@Service
public class DetectionService {

    private static final Logger log = LoggerFactory.getLogger(DetectionService.class);

    private final JdbcTemplate jdbc;
    private final JdbcDetectionHistory history;
    private final DetectionEngine engine;
    private final ReferenceDataService reference;
    private final AlertService alertService;
    private final CustomerLock customerLock;
    private final AuditService audit;
    private final TransactionTemplate txTemplate;
    private final ZoneId zone;
    private final SentinelProperties.Guardrails guardrails;

    public DetectionService(JdbcTemplate jdbc, JdbcDetectionHistory history, DetectionEngine engine,
                            ReferenceDataService reference, AlertService alertService, CustomerLock customerLock,
                            AuditService audit, PlatformTransactionManager txManager, SentinelProperties props) {
        this.jdbc = jdbc;
        this.history = history;
        this.engine = engine;
        this.reference = reference;
        this.alertService = alertService;
        this.customerLock = customerLock;
        this.audit = audit;
        this.txTemplate = new TransactionTemplate(txManager);
        this.zone = props.zone();
        this.guardrails = props.guardrails();
    }

    public record Outcome(long txnId, String txnRef, List<String> rulesFired, Long alertId, String alertRef,
                          boolean alertCreated, Integer riskScore, Decision decision, List<String> decisionReasons,
                          boolean accountFrozen, boolean degraded, boolean skipped) {

        static Outcome skipped(long txnId) {
            return new Outcome(txnId, null, List.of(), null, null, false, null, null, List.of(), false, false, true);
        }
    }

    /** Bulk / back-dated path: own transaction, verdict informational only (no account freeze). */
    public Outcome detect(long txnId) {
        return txTemplate.execute(status -> evaluate(txnId, false));
    }

    /** Streaming path: runs in the caller's transaction so insert + detection + verdict commit atomically. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Outcome detectInCurrentTransaction(long txnId) {
        return evaluate(txnId, true);
    }

    private Outcome evaluate(long txnId, boolean realtime) {
        List<Long> customer = jdbc.queryForList("SELECT customer_id FROM bank_transaction WHERE id = ?", Long.class, txnId);
        if (customer.isEmpty()) {
            return Outcome.skipped(txnId);
        }
        customerLock.lock(customer.get(0));

        List<String[]> meta = jdbc.query("""
                        SELECT c.kyc_risk_rating, a.status, t.evaluated_at IS NOT NULL AS done
                        FROM bank_transaction t JOIN customer c ON c.id = t.customer_id JOIN account a ON a.id = t.account_id
                        WHERE t.id = ?""",
                (rs, i) -> rs.getBoolean("done") ? null : new String[]{rs.getString(1), rs.getString(2)}, txnId);
        if (meta.isEmpty() || meta.get(0) == null) {
            return Outcome.skipped(txnId); // already evaluated by another worker
        }
        RiskRating customerRisk = RiskRating.valueOf(meta.get(0)[0]);
        String accountStatus = meta.get(0)[1];
        TxnView txn = history.load(txnId);

        DetectionEngine.Result result = engine.evaluate(new RuleContext(txn, history, reference, zone));
        List<RuleHit> hits = result.hits();
        AlertService.RaiseResult raised = hits.isEmpty() ? null : alertService.raise(txn, hits, customerRisk);
        Integer score = raised == null ? null : raised.alert().getRiskScore();

        PaymentDecisionPolicy.Result verdict = PaymentDecisionPolicy.decide(txn, accountStatus, hits, score,
                result.failedRules(), guardrails.holdScore());
        boolean frozen = false;
        if (realtime && verdict.freezeAccount() && guardrails.autoFreezeOnSanctions()) {
            frozen = jdbc.update("UPDATE account SET status = 'FROZEN' WHERE id = ? AND status = 'ACTIVE'", txn.accountId()) == 1;
            if (frozen) {
                audit.record("ACCOUNT", txn.accountId(), "ACCOUNT_FROZEN", "ACTIVE", "FROZEN", AlertService.ENGINE_ACTOR,
                        Map.of("triggerTxn", txn.txnRef(), "alert", raised.alert().getAlertRef(), "reasons", verdict.reasons()));
                log.warn("GUARDRAIL account {} frozen after sanctioned-party payment {}", txn.accountId(), txn.txnRef());
            }
        }
        if (realtime && verdict.decision() == Decision.HOLD) {
            audit.record("TRANSACTION", txn.txnRef(), "PAYMENT_HOLD", null, Decision.HOLD.name(), AlertService.ENGINE_ACTOR,
                    Map.of("reasons", verdict.reasons()));
        }

        if (result.degraded()) {
            log.error("Txn {} evaluated in degraded mode (failed rules {}); left pending for re-drive",
                    txn.txnRef(), result.failedRules());
        } else {
            jdbc.update("UPDATE bank_transaction SET evaluated_at = now() WHERE id = ?", txnId);
        }
        if (raised != null) {
            log.info("Txn {} fired {} -> {} {} (score {}, verdict {})", txn.txnRef(), hits.stream().map(RuleHit::ruleCode).toList(),
                    raised.created() ? "new alert" : "aggregated into", raised.alert().getAlertRef(), score, verdict.decision());
        }
        return new Outcome(txnId, txn.txnRef(), hits.stream().map(RuleHit::ruleCode).toList(),
                raised == null ? null : raised.alert().getId(), raised == null ? null : raised.alert().getAlertRef(),
                raised != null && raised.created(), score, verdict.decision(), verdict.reasons(), frozen,
                result.degraded(), false);
    }
}
