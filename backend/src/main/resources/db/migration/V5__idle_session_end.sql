-- Allow server-side expiry of abandoned sessions without changing API enum values.
ALTER TABLE study_sessions DROP CONSTRAINT study_sessions_check;
ALTER TABLE study_sessions ADD CONSTRAINT study_sessions_check CHECK (
    (status = 'ACTIVE' AND ended_at IS NULL AND end_reason IS NULL)
    OR (status = 'ENDED' AND ended_at >= started_at
        AND end_reason IN ('SESSION_ENDED', 'SESSION_REPLACED', 'HEARTBEAT_TIMEOUT'))
);
