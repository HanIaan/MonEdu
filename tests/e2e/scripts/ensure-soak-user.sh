#!/usr/bin/env bash
# Adds the soak-only student (soak@demo.local / demo1234!, assigned to teacher2) to the LOCAL dev DB.
# Additive and idempotent; never deletes data. Usage: scripts/ensure-soak-user.sh [container]
set -euo pipefail
C=${1:-study-monitor-postgres-1}
docker exec "$C" psql -U "${POSTGRES_USER:-study_monitor}" -d "${POSTGRES_DB:-study_monitor}" -v ON_ERROR_STOP=1 -c "
INSERT INTO users (id,email,password_hash,display_name,role,created_at) VALUES
 ('20000000-0000-0000-0000-0000000000a1','soak@demo.local','\$2a\$10\$rskm0Zc.tvE73/nyPoxLde7JrIHHUh4Upg6NSdXuoHLOsx1VHUhWS','Soak Student','STUDENT',CURRENT_TIMESTAMP)
 ON CONFLICT DO NOTHING;
INSERT INTO teacher_students (teacher_id,student_id,created_at) VALUES
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-0000000000a1',CURRENT_TIMESTAMP)
 ON CONFLICT DO NOTHING;"
