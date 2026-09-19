-- Sentinel AML core schema
-- customer -> account -> bank_transaction ; alert -> alert_evidence -> bank_transaction ; aml_case -> case_alert -> alert

CREATE TABLE customer (
    id               BIGSERIAL PRIMARY KEY,
    external_ref     VARCHAR(40)  NOT NULL UNIQUE,
    full_name        VARCHAR(200) NOT NULL,
    national_id      VARCHAR(40)  NOT NULL,
    date_of_birth    DATE,
    customer_type    VARCHAR(20)  NOT NULL CHECK (customer_type IN ('RETAIL', 'BUSINESS')),
    country          CHAR(2)      NOT NULL,
    kyc_risk_rating  VARCHAR(10)  NOT NULL CHECK (kyc_risk_rating IN ('LOW', 'MEDIUM', 'HIGH')),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE account (
    id               BIGSERIAL PRIMARY KEY,
    account_number   VARCHAR(40)  NOT NULL UNIQUE,
    customer_id      BIGINT       NOT NULL REFERENCES customer (id),
    account_type     VARCHAR(20)  NOT NULL CHECK (account_type IN ('SAVINGS', 'CURRENT', 'BUSINESS', 'NRE', 'WALLET')),
    currency         CHAR(3)      NOT NULL,
    opened_on        DATE         NOT NULL,
    risk_rating      VARCHAR(10)  NOT NULL CHECK (risk_rating IN ('LOW', 'MEDIUM', 'HIGH')),
    status           VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED')),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_account_customer ON account (customer_id);

CREATE TABLE exchange_rate (
    currency         CHAR(3)        PRIMARY KEY,
    rate_to_base     NUMERIC(19, 8) NOT NULL CHECK (rate_to_base > 0),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_by       VARCHAR(60)    NOT NULL DEFAULT 'system'
);

CREATE TABLE bank_transaction (
    id                   BIGSERIAL PRIMARY KEY,
    txn_ref              VARCHAR(60)    NOT NULL UNIQUE,
    account_id           BIGINT         NOT NULL REFERENCES account (id),
    customer_id          BIGINT         NOT NULL REFERENCES customer (id),
    direction            VARCHAR(6)     NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
    amount               NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
    currency             CHAR(3)        NOT NULL REFERENCES exchange_rate (currency),
    amount_base          NUMERIC(19, 4) NOT NULL,
    counterparty_name    VARCHAR(200),
    counterparty_account VARCHAR(60),
    counterparty_country CHAR(2),
    channel              VARCHAR(20)    NOT NULL CHECK (channel IN ('CASH', 'WIRE', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CARD', 'ATM', 'CHEQUE', 'SWIFT')),
    jurisdiction         CHAR(2),
    occurred_at          TIMESTAMPTZ    NOT NULL,
    ingested_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
    evaluated_at         TIMESTAMPTZ
);
CREATE INDEX ix_txn_account_time  ON bank_transaction (account_id, occurred_at);
CREATE INDEX ix_txn_customer_time ON bank_transaction (customer_id, occurred_at);
CREATE INDEX ix_txn_unevaluated   ON bank_transaction (occurred_at) WHERE evaluated_at IS NULL;

CREATE TABLE watchlist_entry (
    id           BIGSERIAL PRIMARY KEY,
    entry_type   VARCHAR(20)  NOT NULL CHECK (entry_type IN ('COUNTRY', 'COUNTERPARTY')),
    value        VARCHAR(200) NOT NULL,
    list_name    VARCHAR(60)  NOT NULL,
    reason       VARCHAR(300),
    active       BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (entry_type, value)
);

CREATE TABLE rule_config (
    rule_code    VARCHAR(40)  PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(500) NOT NULL,
    enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    weight       INT          NOT NULL CHECK (weight BETWEEN 0 AND 100),
    params       JSONB        NOT NULL,
    version      INT          NOT NULL DEFAULT 1,
    updated_by   VARCHAR(60)  NOT NULL DEFAULT 'system',
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE rule_config_history (
    id           BIGSERIAL PRIMARY KEY,
    rule_code    VARCHAR(40)  NOT NULL REFERENCES rule_config (rule_code),
    version      INT          NOT NULL,
    enabled      BOOLEAN      NOT NULL,
    weight       INT          NOT NULL,
    params       JSONB        NOT NULL,
    changed_by   VARCHAR(60)  NOT NULL,
    changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (rule_code, version)
);

CREATE TABLE alert (
    id                  BIGSERIAL PRIMARY KEY,
    alert_ref           VARCHAR(30)  NOT NULL UNIQUE,
    customer_id         BIGINT       NOT NULL REFERENCES customer (id),
    status              VARCHAR(20)  NOT NULL CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED')),
    risk_score          INT          NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    rule_codes          TEXT[]       NOT NULL,
    rule_details        JSONB        NOT NULL,
    explanation         TEXT         NOT NULL,
    window_start        TIMESTAMPTZ  NOT NULL,
    window_end          TIMESTAMPTZ  NOT NULL,
    hit_count           INT          NOT NULL DEFAULT 1,
    assignee            VARCHAR(60),
    disposition         VARCHAR(30)  CHECK (disposition IN ('FALSE_POSITIVE', 'TRUE_POSITIVE', 'NO_FURTHER_ACTION')),
    disposition_reason  VARCHAR(1000),
    disposed_by         VARCHAR(60),
    disposed_at         TIMESTAMPTZ,
    case_id             BIGINT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    row_version         BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX ix_alert_queue    ON alert (status, risk_score DESC, created_at DESC);
CREATE INDEX ix_alert_customer ON alert (customer_id, status, window_end);

CREATE TABLE alert_evidence (
    alert_id        BIGINT      NOT NULL REFERENCES alert (id),
    transaction_id  BIGINT      NOT NULL REFERENCES bank_transaction (id),
    rule_code       VARCHAR(40) NOT NULL,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (alert_id, transaction_id, rule_code)
);
CREATE INDEX ix_evidence_txn ON alert_evidence (transaction_id);

CREATE TABLE aml_case (
    id              BIGSERIAL PRIMARY KEY,
    case_ref        VARCHAR(30)  NOT NULL UNIQUE,
    customer_id     BIGINT       NOT NULL REFERENCES customer (id),
    title           VARCHAR(200) NOT NULL,
    status          VARCHAR(20)  NOT NULL CHECK (status IN ('OPEN', 'INVESTIGATING', 'SAR_FILED', 'CLOSED')),
    priority        VARCHAR(10)  NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    assignee        VARCHAR(60),
    outcome         VARCHAR(1000),
    created_by      VARCHAR(60)  NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    row_version     BIGINT       NOT NULL DEFAULT 0
);
ALTER TABLE alert ADD CONSTRAINT fk_alert_case FOREIGN KEY (case_id) REFERENCES aml_case (id);

CREATE TABLE case_note (
    id          BIGSERIAL PRIMARY KEY,
    case_id     BIGINT        NOT NULL REFERENCES aml_case (id),
    author      VARCHAR(60)   NOT NULL,
    body        VARCHAR(4000) NOT NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    entity_type  VARCHAR(30)  NOT NULL,
    entity_id    VARCHAR(60)  NOT NULL,
    action       VARCHAR(40)  NOT NULL,
    from_state   VARCHAR(30),
    to_state     VARCHAR(30),
    actor        VARCHAR(60)  NOT NULL,
    details      JSONB,
    occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id, occurred_at);

CREATE TABLE ingestion_error (
    id           BIGSERIAL PRIMARY KEY,
    batch_id     UUID         NOT NULL,
    record_type  VARCHAR(20)  NOT NULL,
    line_no      INT,
    record_key   VARCHAR(100),
    raw          TEXT,
    error        VARCHAR(2000) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_ingestion_error_batch ON ingestion_error (batch_id);

-- ---------------------------------------------------------------------------
-- Immutability guards (Business Rule 6 + audit NFR)
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% on table % is not permitted (immutable record)', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable   BEFORE UPDATE OR DELETE ON audit_log      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER alert_no_delete       BEFORE DELETE           ON alert          FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER evidence_no_delete    BEFORE DELETE           ON alert_evidence FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER case_note_immutable   BEFORE UPDATE OR DELETE ON case_note      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER rule_history_immutable BEFORE UPDATE OR DELETE ON rule_config_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER alert_no_truncate     BEFORE TRUNCATE ON alert     FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE SEQUENCE alert_ref_seq START 100001;
CREATE SEQUENCE case_ref_seq START 5001;
