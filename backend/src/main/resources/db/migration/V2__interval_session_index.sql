-- Day reports select intervals by session_id; the partial open-interval index cannot serve
-- historical (closed) rows. Also supports FK checks when deleting an ended session.
CREATE INDEX activity_intervals_session_start_idx ON activity_intervals(session_id, started_at, id);
