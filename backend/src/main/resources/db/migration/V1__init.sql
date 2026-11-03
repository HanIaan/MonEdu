CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE users (
 id uuid PRIMARY KEY, email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
 password_hash varchar(100) NOT NULL, display_name varchar(100) NOT NULL,
 role varchar(16) NOT NULL CHECK (role IN ('STUDENT','TEACHER')), created_at timestamptz NOT NULL
);
CREATE TABLE teacher_students (
 teacher_id uuid NOT NULL REFERENCES users, student_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL, PRIMARY KEY (teacher_id, student_id), CHECK (teacher_id <> student_id)
);
CREATE INDEX teacher_students_student_idx ON teacher_students(student_id);
CREATE TABLE study_sessions (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users,
 status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','ENDED')), study_date date NOT NULL,
 started_at timestamptz NOT NULL, ended_at timestamptz, end_reason varchar(32),
 current_state varchar(32) NOT NULL CHECK (current_state IN ('FOCUS_ESTIMATED','DISTRACTION_SUSPECTED','AWAY','UNKNOWN','BREAK')),
 current_state_since timestamptz NOT NULL, last_seq bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
 last_heartbeat_at timestamptz, verified_until timestamptz NOT NULL, client_info jsonb,
 version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL,
 CHECK ((status = 'ACTIVE' AND ended_at IS NULL AND end_reason IS NULL) OR
        (status = 'ENDED' AND ended_at >= started_at AND end_reason IN ('SESSION_ENDED','SESSION_REPLACED'))),
 CHECK (current_state_since >= started_at AND verified_until >= started_at)
);
CREATE UNIQUE INDEX study_sessions_one_active_idx ON study_sessions(student_id) WHERE status = 'ACTIVE';
CREATE INDEX study_sessions_student_date_idx ON study_sessions(student_id, study_date);
CREATE INDEX study_sessions_timeout_idx ON study_sessions(status, last_heartbeat_at);
CREATE TABLE monitoring_events (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES study_sessions, student_id uuid NOT NULL REFERENCES users,
 event_id uuid UNIQUE, seq bigint, source varchar(8) NOT NULL CHECK (source IN ('CLIENT','SERVER')),
 state varchar(32) NOT NULL CHECK (state IN ('FOCUS_ESTIMATED','DISTRACTION_SUSPECTED','AWAY','UNKNOWN','BREAK')),
 reason varchar(32) NOT NULL CHECK (reason IN ('SESSION_STARTED','SEATED_CONFIRMED','FOCUS_RESUMED','PRESENCE_LOST','PHONE_SUSPECTED','LOW_CONFIDENCE','CAMERA_STOPPED','CAMERA_PERMISSION_DENIED','INFERENCE_STALLED','MODEL_ERROR','MONITORING_PAUSED','BREAK_STARTED','BREAK_ENDED','RECONNECTED','HEARTBEAT_TIMEOUT','SESSION_ENDED','SESSION_REPLACED')),
 detected_at timestamptz, effective_at timestamptz NOT NULL, server_received_at timestamptz NOT NULL,
 confidence real CHECK (confidence >= 0 AND confidence <= 1), signals jsonb, response jsonb,
 UNIQUE (session_id, seq), CHECK (seq IS NULL OR seq > 0),
 CHECK ((source = 'SERVER' AND event_id IS NULL AND seq IS NULL) OR (source = 'CLIENT' AND event_id IS NOT NULL AND seq IS NOT NULL AND detected_at IS NOT NULL))
);
CREATE INDEX monitoring_events_session_received_idx ON monitoring_events(session_id, server_received_at);
CREATE TABLE activity_intervals (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES study_sessions, student_id uuid NOT NULL REFERENCES users,
 state varchar(32) NOT NULL CHECK (state IN ('FOCUS_ESTIMATED','DISTRACTION_SUSPECTED','AWAY','UNKNOWN','BREAK')),
 reason varchar(32) NOT NULL CHECK (reason IN ('SESSION_STARTED','SEATED_CONFIRMED','FOCUS_RESUMED','PRESENCE_LOST','PHONE_SUSPECTED','LOW_CONFIDENCE','CAMERA_STOPPED','CAMERA_PERMISSION_DENIED','INFERENCE_STALLED','MODEL_ERROR','MONITORING_PAUSED','BREAK_STARTED','BREAK_ENDED','RECONNECTED','HEARTBEAT_TIMEOUT','SESSION_ENDED','SESSION_REPLACED')),
 started_at timestamptz NOT NULL, ended_at timestamptz,
 opened_by_event_id uuid REFERENCES monitoring_events, created_at timestamptz NOT NULL,
 CHECK (ended_at IS NULL OR ended_at > started_at),
 CONSTRAINT activity_intervals_no_overlap EXCLUDE USING gist
 (student_id WITH =, tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') WITH &&)
);
CREATE UNIQUE INDEX activity_intervals_one_open_idx ON activity_intervals(session_id) WHERE ended_at IS NULL;
CREATE INDEX activity_intervals_student_start_idx ON activity_intervals(student_id, started_at);
