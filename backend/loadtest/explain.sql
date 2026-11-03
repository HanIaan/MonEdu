-- Run only in the isolated load DB, outside measured HTTP scenarios.
-- 1,000 students x 200 closed intervals = 200,000 historical rows.
-- Everything, including the temporary candidate index, rolls back.
\set ON_ERROR_STOP on
BEGIN;
DROP INDEX IF EXISTS activity_intervals_session_start_idx;
INSERT INTO users
SELECT md5('plan-user-'||n)::uuid,'plan'||n||'@test.local','unused','Plan '||n,'STUDENT',now()
FROM generate_series(1,1000) n;
INSERT INTO study_sessions
(id,student_id,status,study_date,started_at,ended_at,end_reason,current_state,current_state_since,last_seq,verified_until,created_at)
SELECT md5('plan-session-'||n)::uuid,md5('plan-user-'||n)::uuid,'ENDED',CURRENT_DATE-1,
CURRENT_DATE-interval '1 day',CURRENT_DATE-interval '1 day'+interval '100 minutes','SESSION_ENDED',
'FOCUS_ESTIMATED',CURRENT_DATE-interval '1 day',200,CURRENT_DATE-interval '1 day'+interval '100 minutes',now()
FROM generate_series(1,1000) n;
INSERT INTO activity_intervals(id,session_id,student_id,state,reason,started_at,ended_at,created_at)
SELECT md5('plan-interval-'||n||'-'||i)::uuid,md5('plan-session-'||n)::uuid,md5('plan-user-'||n)::uuid,
CASE WHEN i%2=0 THEN 'FOCUS_ESTIMATED' ELSE 'AWAY' END,
CASE WHEN i%2=0 THEN 'SEATED_CONFIRMED' ELSE 'PRESENCE_LOST' END,
CURRENT_DATE-interval '1 day'+i*interval '30 seconds',CURRENT_DATE-interval '1 day'+(i+1)*interval '30 seconds',now()
FROM generate_series(1,1000) n CROSS JOIN generate_series(0,199) i;
ANALYZE study_sessions;
ANALYZE activity_intervals;
\echo BEFORE: single-student day intervals (200 rows)
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM activity_intervals WHERE session_id=md5('plan-session-1')::uuid ORDER BY started_at,id;
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM activity_intervals WHERE session_id=md5('plan-session-1')::uuid ORDER BY started_at,id;
\echo BEFORE: batched 100-student teacher intervals (20000 rows)
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM activity_intervals WHERE session_id IN (SELECT md5('plan-session-'||n)::uuid FROM generate_series(1,100) n) ORDER BY started_at,id;
CREATE INDEX activity_intervals_session_start_idx ON activity_intervals(session_id,started_at,id);
ANALYZE activity_intervals;
\echo AFTER: single-student day intervals (200 rows)
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM activity_intervals WHERE session_id=md5('plan-session-1')::uuid ORDER BY started_at,id;
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM activity_intervals WHERE session_id=md5('plan-session-1')::uuid ORDER BY started_at,id;
\echo AFTER: batched 100-student teacher intervals (20000 rows)
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM activity_intervals WHERE session_id IN (SELECT md5('plan-session-'||n)::uuid FROM generate_series(1,100) n) ORDER BY started_at,id;
\echo Day sessions query
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM study_sessions WHERE student_id=md5('plan-user-1')::uuid AND study_date=CURRENT_DATE-1 ORDER BY started_at,id;
ROLLBACK;
