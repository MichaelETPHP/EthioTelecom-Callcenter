-- Postgres equivalent of the mysql/ migration history, consolidated into a
-- single migration since there is no existing Postgres deployment to carry
-- history for. This produces the same final schema as applying all 29
-- files under migrations/mysql in order (verified against the current Go
-- model structs in internal/sms-gateway/**/models.go as of 2026-09-10).
--
-- Notable translations from MySQL:
--   - backticked identifiers -> unquoted (already lowercase snake_case)
--   - AUTO_INCREMENT -> GENERATED ALWAYS AS IDENTITY
--   - ENUM(...) columns -> varchar + CHECK constraint
--   - tinyint(1) unsigned "boolean" columns -> boolean
--   - datetime(3) -> timestamp(3)
--   - inline INDEX/UNIQUE INDEX clauses -> separate CREATE INDEX statements
--   - ON UPDATE CURRENT_TIMESTAMP(3) -> BEFORE UPDATE trigger (Postgres has
--     no column-level equivalent); required because TimedModel in
--     internal/sms-gateway/models/models.go sets autoupdatetime:false and
--     relies entirely on the database to bump updated_at
--
-- This is a shared Postgres instance (other projects' schemas, e.g.
-- Tombola_DB, live alongside ours) - all tables here live in the
-- "EthioTelecom-APP-DB" schema, not "public". Table names in the app's Go
-- code (GORM TableName()) are unqualified, so this relies on that schema
-- being on the connection's search_path. Because the instance is shared,
-- that is deliberately NOT done here via ALTER DATABASE/ROLE on the shared
-- "postgres" login (that would repoint search_path for every other project
-- using that same login too). Instead it's a one-time, already-applied,
-- out-of-band bootstrap scoped to a dedicated role - see
-- scripts/postgres-bootstrap.sql - which created a dedicated
-- "ethiotelecom_app" role owning this schema with its search_path scoped
-- to just that role, and configs/config.yml connects as that role.

-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    -- clock_timestamp(), not CURRENT_TIMESTAMP/now(): the latter is frozen
    -- to the transaction's start time in Postgres, so within a multi-
    -- statement transaction it would never actually advance between an
    -- INSERT and a later UPDATE. MySQL's ON UPDATE CURRENT_TIMESTAMP that
    -- this replaces does advance per-statement, so clock_timestamp() is the
    -- behavioral match.
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE users (
    id varchar(32) PRIMARY KEY,
    password_hash varchar(72) NOT NULL,
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    deleted_at timestamp(3) NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE devices (
    id varchar(21) PRIMARY KEY,
    name varchar(128),
    auth_token varchar(21) NOT NULL,
    push_token varchar(256),
    user_id varchar(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    deleted_at timestamp(3) NULL,
    last_seen timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    sim_cards jsonb NOT NULL DEFAULT '[]'::jsonb
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_devices_auth_token ON devices(auth_token);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_devices_last_seen ON devices(last_seen);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id varchar(21) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_id varchar(32) NOT NULL,
    ext_id varchar(36) NOT NULL,
    type varchar(16) NOT NULL DEFAULT 'Text' CHECK (type IN ('Text', 'Data')),
    content text NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'Pending' CHECK (state IN ('Pending', 'Cancelling', 'Cancelled', 'Processed', 'Sent', 'Delivered', 'Failed')),
    valid_until timestamp(3),
    schedule_at timestamp,
    sim_number smallint,
    with_delivery_report boolean NOT NULL DEFAULT true,
    priority smallint NOT NULL DEFAULT 0,
    is_hashed boolean NOT NULL DEFAULT false,
    is_encrypted boolean NOT NULL DEFAULT false,
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    deleted_at timestamp(3) NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX unq_messages_id_device ON messages(ext_id, device_id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_messages_device_state ON messages(device_id, state);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_messages_created_at ON messages(created_at);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_messages_device_created_at ON messages(device_id, created_at);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_messages_unhashed ON messages(is_hashed, is_encrypted, state);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_messages_user_created_at ON messages(user_id, created_at);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE message_recipients (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    phone_number varchar(128) NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'Pending' CHECK (state IN ('Pending', 'Cancelling', 'Cancelled', 'Processed', 'Sent', 'Delivered', 'Failed')),
    error varchar(256)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX unq_message_recipients_message_id_phone_number ON message_recipients(message_id, phone_number);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE message_states (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    state varchar(16) NOT NULL CHECK (state IN ('Pending', 'Cancelling', 'Cancelled', 'Processed', 'Sent', 'Delivered', 'Failed')),
    updated_at timestamp(3) NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX unq_message_states_message_id_state ON message_states(message_id, state);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE webhooks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ext_id varchar(36) NOT NULL,
    user_id varchar(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url varchar(256) NOT NULL,
    event varchar(32) NOT NULL,
    device_id varchar(21) REFERENCES devices(id) ON DELETE CASCADE,
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    deleted_at timestamp(3) NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX unq_webhooks_user_extid ON webhooks(user_id, ext_id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_webhooks_device ON webhooks(device_id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER trg_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE device_settings (
    user_id varchar(32) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings jsonb NOT NULL,
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER trg_device_settings_updated_at BEFORE UPDATE ON device_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE tokens (
    id varchar(21) PRIMARY KEY,
    user_id varchar(21) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_use varchar(16) NOT NULL DEFAULT 'access' CHECK (token_use IN ('access', 'refresh')),
    parent_jti varchar(21),
    expires_at timestamp(3) NOT NULL,
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    revoked_at timestamp(3) NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_tokens_user_id ON tokens(user_id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_tokens_expires_at ON tokens(expires_at);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_tokens_parent_jti ON tokens(parent_jti);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER trg_tokens_updated_at BEFORE UPDATE ON tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd

-------------------------------------------------------------------------------
-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tokens;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS device_settings;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS webhooks;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS message_states;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS message_recipients;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS messages;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS devices;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS users;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION IF EXISTS set_updated_at();
-- +goose StatementEnd
