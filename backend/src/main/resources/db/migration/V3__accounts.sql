ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN terms_agreed_at timestamptz;
ALTER TABLE users ADD COLUMN privacy_agreed_at timestamptz;
ALTER TABLE users ADD COLUMN agreements_version varchar(32);

CREATE TABLE user_identities (
    provider varchar(16) NOT NULL CHECK (provider IN ('KAKAO')),
    provider_user_id varchar(64) NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX user_identities_user_idx ON user_identities(user_id);
CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    family_id uuid NOT NULL,
    token_hash char(64) NOT NULL UNIQUE,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid REFERENCES refresh_tokens(id),
    user_agent varchar(256)
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);
CREATE TABLE teacher_invite_codes (
    code varchar(8) PRIMARY KEY,
    teacher_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE UNIQUE INDEX teacher_invite_codes_active_idx ON teacher_invite_codes(teacher_id) WHERE revoked_at IS NULL;
