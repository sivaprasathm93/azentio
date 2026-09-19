package com.meridian.sentinel.detection.rules;

import com.meridian.sentinel.common.Money;
import com.meridian.sentinel.detection.DetectionRule;
import com.meridian.sentinel.detection.ReferenceData.WatchlistHit;
import com.meridian.sentinel.detection.RuleContext;
import com.meridian.sentinel.detection.RuleHit;
import com.meridian.sentinel.detection.TxnView;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Business Rule 4: counterparty country, transaction jurisdiction or counterparty name on an active
 * high-risk / sanctions list always alerts, regardless of amount.
 */
@Component
public class HighRiskJurisdictionRule implements DetectionRule<HighRiskJurisdictionRule.Params> {

    public static final String CODE = "HIGH_RISK_JURISDICTION";
    /** Severity reserved for a named sanctioned counterparty (the strongest signal; drives account freeze). */
    public static final double SANCTIONED_PARTY_SEVERITY = 1.0;
    static final double HIGH_RISK_COUNTRY_SEVERITY = 0.9;

    public record Params(boolean matchCounterpartyName) {
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public Class<Params> paramsType() {
        return Params.class;
    }

    @Override
    public Optional<RuleHit> evaluate(RuleContext ctx, Params p) {
        TxnView t = ctx.txn();
        List<String> reasons = new ArrayList<>();
        double severity = 0;

        Optional<WatchlistHit> cpCountry = ctx.reference().matchCountry(t.counterpartyCountry());
        if (cpCountry.isPresent()) {
            reasons.add("counterparty country " + t.counterpartyCountry() + " is on " + cpCountry.get().listName());
            severity = Math.max(severity, HIGH_RISK_COUNTRY_SEVERITY);
        }
        if (t.jurisdiction() != null && !t.jurisdiction().equals(t.counterpartyCountry())) {
            Optional<WatchlistHit> juris = ctx.reference().matchCountry(t.jurisdiction());
            if (juris.isPresent()) {
                reasons.add("transaction jurisdiction " + t.jurisdiction() + " is on " + juris.get().listName());
                severity = Math.max(severity, HIGH_RISK_COUNTRY_SEVERITY);
            }
        }
        if (p.matchCounterpartyName()) {
            Optional<WatchlistHit> party = ctx.reference().matchCounterparty(t.counterpartyName());
            if (party.isPresent()) {
                reasons.add("counterparty '" + t.counterpartyName() + "' matches " + party.get().listName() + " entry");
                severity = SANCTIONED_PARTY_SEVERITY;
            }
        }
        if (reasons.isEmpty()) {
            return Optional.empty();
        }
        String explanation = String.format("%s %s of %s via %s: %s.",
                t.isCredit() ? "Incoming" : "Outgoing", t.isCredit() ? "credit" : "debit",
                Money.fmt(t.amount(), t.currency()), t.channel(), String.join("; ", reasons));
        return Optional.of(new RuleHit(CODE, severity, List.of(t.id()), explanation));
    }
}
