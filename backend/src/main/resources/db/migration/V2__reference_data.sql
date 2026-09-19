-- Base currency is INR. rate_to_base = INR per 1 unit of currency. Editable via /api/v1/admin/fx-rates.
INSERT INTO exchange_rate (currency, rate_to_base) VALUES
    ('INR', 1.0),
    ('USD', 83.50),
    ('EUR', 90.80),
    ('GBP', 106.20),
    ('AED', 22.73),
    ('SGD', 62.40),
    ('CHF', 94.10);

-- High-risk / sanctioned jurisdictions (illustrative) and fictitious sanctioned counterparties.
INSERT INTO watchlist_entry (entry_type, value, list_name, reason) VALUES
    ('COUNTRY', 'KP', 'FATF_BLACKLIST', 'FATF call for action'),
    ('COUNTRY', 'IR', 'FATF_BLACKLIST', 'FATF call for action'),
    ('COUNTRY', 'MM', 'FATF_BLACKLIST', 'FATF call for action'),
    ('COUNTRY', 'SY', 'SANCTIONS', 'Comprehensive sanctions programme'),
    ('COUNTRY', 'YE', 'FATF_GREYLIST', 'Increased monitoring'),
    ('COUNTRY', 'AF', 'SANCTIONS', 'Targeted sanctions'),
    ('COUNTERPARTY', 'ORION SHELL HOLDINGS LTD', 'INTERNAL_WATCHLIST', 'Fictitious shell entity used in demo data'),
    ('COUNTERPARTY', 'BLUE LAGOON TRADING FZE', 'SANCTIONS', 'Fictitious sanctioned trading house used in demo data');

-- Detection rules. Thresholds are expressed in a reference currency and converted to INR at evaluation time,
-- so a change to the FX table or to these params takes effect immediately without redeployment.
INSERT INTO rule_config (rule_code, name, description, weight, params) VALUES
    ('CTR_THRESHOLD', 'Large transaction (CTR)',
     'Any single transaction at or above the currency transaction reporting threshold.',
     30, '{"thresholdAmount": 10000, "thresholdCurrency": "USD"}'),
    ('STRUCTURING', 'Structuring / smurfing',
     'Several transactions on one account inside a short window, each just below the reporting threshold.',
     45, '{"lowerAmount": 9000, "upperAmount": 9999.99, "currency": "USD", "minCount": 3, "windowHours": 24}'),
    ('RAPID_MOVEMENT', 'Rapid movement of funds',
     'Funds credited to an account and largely moved out again within a short window (layering).',
     40, '{"windowHours": 48, "outflowRatio": 0.80, "minInflowAmount": 5000, "currency": "USD"}'),
    ('HIGH_RISK_JURISDICTION', 'High-risk jurisdiction / sanctioned party',
     'Counterparty country, transaction jurisdiction or counterparty name is on an active watchlist. Always alerts regardless of amount.',
     60, '{"matchCounterpartyName": true}'),
    ('BEHAVIORAL_DEVIATION', 'Behavioural deviation',
     'Customer daily transaction value exceeds a multiple of the rolling daily average.',
     30, '{"multiplier": 3.0, "lookbackDays": 90, "minHistoryDays": 30, "minDailyAmount": 2500, "minDailyCount": 10, "currency": "USD"}'),
    ('ROUND_AMOUNT', 'Repeated round amounts',
     'Repeated transactions in suspiciously round amounts on one account inside a window.',
     20, '{"roundingUnit": 1000, "minAmount": 1000, "currency": "USD", "minCount": 3, "windowHours": 168}');

INSERT INTO rule_config_history (rule_code, version, enabled, weight, params, changed_by)
SELECT rule_code, version, enabled, weight, params, 'system' FROM rule_config;
