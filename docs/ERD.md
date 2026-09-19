# Sentinel AML – Data model

Source of truth: Flyway migrations in [`backend/src/main/resources/db/migration`](../backend/src/main/resources/db/migration)
(`V1__schema.sql` = structure + immutability triggers, `V2__reference_data.sql` = FX rates, watchlist, rule configuration).

```mermaid
erDiagram
    CUSTOMER ||--o{ ACCOUNT : owns
    CUSTOMER ||--o{ BANK_TRANSACTION : "denormalised for fast per-customer queries"
    ACCOUNT ||--o{ BANK_TRANSACTION : books
    EXCHANGE_RATE ||--o{ BANK_TRANSACTION : "currency (FK)"
    CUSTOMER ||--o{ ALERT : "raised for"
    ALERT ||--o{ ALERT_EVIDENCE : "supported by"
    BANK_TRANSACTION ||--o{ ALERT_EVIDENCE : "is evidence in"
    AML_CASE ||--o{ ALERT : groups
    CUSTOMER ||--o{ AML_CASE : "investigated in"
    AML_CASE ||--o{ CASE_NOTE : has
    RULE_CONFIG ||--o{ RULE_CONFIG_HISTORY : versions

    CUSTOMER {
        bigserial id PK
        varchar external_ref UK "KYC business key"
        varchar full_name "PII - masked in list views"
        varchar national_id "PII - masked in list views"
        date date_of_birth "PII"
        varchar customer_type "RETAIL | BUSINESS"
        char country
        varchar kyc_risk_rating "LOW | MEDIUM | HIGH"
    }
    ACCOUNT {
        bigserial id PK
        varchar account_number UK
        bigint customer_id FK
        varchar account_type
        char currency
        date opened_on
        varchar risk_rating
        varchar status "ACTIVE | DORMANT | FROZEN | CLOSED"
    }
    BANK_TRANSACTION {
        bigserial id PK
        varchar txn_ref UK "idempotency key"
        bigint account_id FK
        bigint customer_id FK
        varchar direction "CREDIT | DEBIT"
        numeric amount "original currency, NUMERIC(19,4)"
        char currency FK
        numeric amount_base "normalised to INR at ingestion (BR9)"
        varchar counterparty_name
        char counterparty_country
        varchar channel
        char jurisdiction
        timestamptz occurred_at
        timestamptz ingested_at
        timestamptz evaluated_at "NULL = not yet evaluated (re-drive)"
    }
    EXCHANGE_RATE {
        char currency PK
        numeric rate_to_base
        varchar updated_by
    }
    WATCHLIST_ENTRY {
        bigserial id PK
        varchar entry_type "COUNTRY | COUNTERPARTY"
        varchar value
        varchar list_name
        boolean active "never deleted"
    }
    RULE_CONFIG {
        varchar rule_code PK
        boolean enabled
        int weight "0-100, used by risk score"
        jsonb params "thresholds / windows"
        int version
    }
    RULE_CONFIG_HISTORY {
        bigserial id PK
        varchar rule_code FK
        int version
        jsonb params
        varchar changed_by "immutable"
    }
    ALERT {
        bigserial id PK
        varchar alert_ref UK
        bigint customer_id FK
        varchar status "OPEN | UNDER_REVIEW | ESCALATED | CLOSED"
        int risk_score "0-100 (BR7)"
        text_array rule_codes
        jsonb rule_details "per-rule severity, hits, rule version, explanation"
        text explanation
        timestamptz window_start
        timestamptz window_end
        varchar disposition "FALSE_POSITIVE | TRUE_POSITIVE | NO_FURTHER_ACTION"
        varchar disposition_reason
        varchar disposed_by
        bigint case_id FK
        bigint row_version "optimistic lock"
    }
    ALERT_EVIDENCE {
        bigint alert_id PK
        bigint transaction_id PK
        varchar rule_code PK
    }
    AML_CASE {
        bigserial id PK
        varchar case_ref UK
        bigint customer_id FK
        varchar status "OPEN | INVESTIGATING | SAR_FILED | CLOSED"
        varchar priority
        varchar assignee
    }
    CASE_NOTE {
        bigserial id PK
        bigint case_id FK
        varchar author
        varchar body "immutable"
    }
    AUDIT_LOG {
        bigserial id PK
        varchar entity_type
        varchar entity_id
        varchar action
        varchar from_state
        varchar to_state
        varchar actor
        jsonb details
        timestamptz occurred_at "append-only"
    }
    INGESTION_ERROR {
        bigserial id PK
        uuid batch_id
        varchar record_type
        int line_no
        text raw
        varchar error
    }
```

## Design notes

| Decision | Why |
|---|---|
| `amount` **and** `amount_base` stored | Keeps the original record exactly as booked while every rule compares like-for-like in INR (BR9). The rate used is fixed at ingestion time, so later FX edits never rewrite history. |
| `NUMERIC(19,4)` everywhere, `BigDecimal` in Java | No floating-point money. |
| `customer_id` denormalised onto `bank_transaction` | Behavioural and aggregation queries are per customer; avoids a join on the hot path. Indexed `(customer_id, occurred_at)` and `(account_id, occurred_at)`. |
| `txn_ref` unique + `INSERT ... ON CONFLICT DO NOTHING` | Idempotent ingestion: replays from the core-banking feed are counted as duplicates, never double-evaluated. |
| `evaluated_at` + partial index `WHERE evaluated_at IS NULL` | Cheap discovery of transactions that still need detection (crash recovery, degraded rules). |
| `alert_evidence` join table (composite PK) | An alert points at exactly the transactions that prove it; `ON CONFLICT DO NOTHING` makes evidence insertion idempotent. |
| `rule_details` JSONB carries the **rule version** | Every alert can be traced to the exact thresholds that produced it (`rule_config_history`). |
| Triggers `forbid_mutation()` | `DELETE`/`TRUNCATE` on `alert`, `alert_evidence`; `UPDATE`/`DELETE` on `audit_log`, `case_note`, `rule_config_history` raise an error **in the database**, so even a bug or a DBA mistake cannot silently remove an alert or rewrite history (BR6, audit NFR). |
| `row_version` on `alert` / `aml_case` | Optimistic locking: two analysts editing the same record get a 409 instead of a lost update. |
