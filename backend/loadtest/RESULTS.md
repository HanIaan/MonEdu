# Phase 2 backend load, security and reliability results

Run date: 2026-11-03. Baseline: integration `d9951a7`; candidate: heartbeat query removal, batched teacher overview, V2 interval index, and SSE disconnect/fan-out fixes. No API/schema wire changes. All numbers below are measured on this machine; none is an extrapolation.

**Open contract issue:** heartbeat-first recovery followed by an old queued focus event can credit offline time. This accounting change is stopped pending C0 clarification; see [CONTRACT_CHANGE_REQUEST.md](CONTRACT_CHANGE_REQUEST.md). All 61 automated tests pass; that does not resolve this contradiction.

## Workload and environment

- macOS 15.8.1 arm64, Mac16,8, 14 logical CPUs, 24 GiB RAM; Java 21.0.9; PostgreSQL 17.11 in Docker. Shared developer machine, not a dedicated performance host.
- Separate backend on 18080 and PostgreSQL on 127.0.0.1:5434. Backend JVM `-Xms256m -Xmx768m`; default Hikari maximum 10. No coordinator services were used.
- Each cohort really ran 10/100/1,000 virtual-thread students, one student SSE each, and 1/1/10 teacher SSE subscribers. Pre-issued JWTs exclude BCrypt/login. All start sessions and establish focus before warm-up.
- Per cohort: 30 s warm-up plus 180 s steady state. Every student sends a heartbeat every 30 s, 20% transition every 30 s, 10% read their day report every 30 s, each teacher reads an overview every 30 s. Cadence is staggered; users wait for each request.
- Throughput is the offered monitoring workload, not the maximum server capacity. SSE events are counted separately. Latency is complete HTTP round-trip time on localhost, nearest-rank quantiles. Small cohorts have only six overview samples, so p95/p99 often equal their maximum.
- Both variants run immutable jar copies. One earlier in-place jar-rebuild run was discarded completely; its files remain only in ignored `raw/discarded/`.

## Headline measurements

| Variant | Students | Steady s | HTTP req/s | HTTP errors | Heartbeat p95 ms | Overview p95 ms | SSE live/expected | SSE drops/reconnects | SSE delay p95 ms |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| before | 10 | 180.0 | 0.467 | 0/84 (0.00%) | 37.50 | 54.30 | 11/11 | 0/0 | 27.0 |
| before | 100 | 180.0 | 4.367 | 0/786 (0.00%) | 13.63 | 208.66 | 101/101 | 0/0 | 17.0 |
| before | 1000 | 180.0 | 43.666 | 0/7860 (0.00%) | 9.18 | 167.47 | 1010/1010 | 0/0 | 14.0 |
| after | 10 | 180.0 | 0.467 | 0/84 (0.00%) | 24.43 | 29.26 | 11/11 | 0/0 | 35.0 |
| after | 100 | 180.0 | 4.366 | 0/786 (0.00%) | 11.80 | 48.76 | 101/101 | 0/0 | 15.0 |
| after | 1000 | 180.0 | 43.660 | 0/7859 (0.00%) | 8.54 | 24.04 | 1010/1010 | 0/0 | 12.0 |

## Endpoint latency

| Variant | Students | Endpoint | Requests | p50 ms | p95 ms | p99 ms | Errors |
|---|---:|---|---:|---:|---:|---:|---:|
| before | 10 | heartbeat | 60 | 17.75 | 37.50 | 65.24 | 0 |
| before | 10 | overview | 6 | 47.26 | 54.30 | 54.30 | 0 |
| before | 10 | report | 6 | 11.53 | 18.25 | 18.25 | 0 |
| before | 10 | transition | 12 | 23.88 | 27.83 | 27.83 | 0 |
| before | 100 | heartbeat | 600 | 8.05 | 13.63 | 18.38 | 0 |
| before | 100 | overview | 6 | 143.47 | 208.66 | 208.66 | 0 |
| before | 100 | report | 60 | 5.41 | 9.29 | 24.23 | 0 |
| before | 100 | transition | 120 | 11.20 | 17.56 | 19.37 | 0 |
| before | 1000 | heartbeat | 6000 | 5.96 | 9.18 | 17.11 | 0 |
| before | 1000 | overview | 60 | 132.09 | 167.47 | 178.83 | 0 |
| before | 1000 | report | 600 | 3.61 | 7.32 | 18.01 | 0 |
| before | 1000 | transition | 1200 | 8.51 | 15.06 | 27.93 | 0 |
| after | 10 | heartbeat | 60 | 15.65 | 24.43 | 42.66 | 0 |
| after | 10 | overview | 6 | 28.56 | 29.26 | 29.26 | 0 |
| after | 10 | report | 6 | 13.00 | 24.83 | 24.83 | 0 |
| after | 10 | transition | 12 | 25.45 | 34.75 | 34.75 | 0 |
| after | 100 | heartbeat | 600 | 6.76 | 11.80 | 17.13 | 0 |
| after | 100 | overview | 6 | 16.12 | 48.76 | 48.76 | 0 |
| after | 100 | report | 60 | 4.63 | 8.28 | 13.87 | 0 |
| after | 100 | transition | 120 | 9.59 | 15.40 | 24.99 | 0 |
| after | 1000 | heartbeat | 5999 | 5.83 | 8.54 | 12.20 | 0 |
| after | 1000 | overview | 60 | 11.53 | 24.04 | 26.91 | 0 |
| after | 1000 | report | 600 | 3.77 | 6.19 | 9.55 | 0 |
| after | 1000 | transition | 1200 | 8.94 | 12.71 | 16.75 | 0 |

Session-start latency was measured separately in the isolated microprobe (30 requests per variant). This is sequential session replacement, not the cohort startup burst.

| Variant | Start p50/p95/p99 ms | Heartbeat p50/p95/p99 ms (100 requests) | Overview p50/p95/p99 ms (10 requests, 100 assigned students) |
|---|---|---|---|
| before | 11.83 / 25.32 / 91.45 | 6.40 / 8.19 / 9.65 | 135.89 / 209.50 / 209.50 |
| after | 13.01 / 29.98 / 151.66 | 6.00 / 7.79 / 10.53 | 20.85 / 55.70 / 55.70 |

## Backend and PostgreSQL resources

CPU is process CPU-time delta / sampled elapsed time during steady state, expressed as percent of one logical CPU (100% = one core). Heap is sampled **used** heap without forcing GC during load; ranges include garbage and are not retained-memory measurements. RSS is sampled peak. PostgreSQL counts subtract the observer connection. Samples are every 10 s and can miss short spikes.

| Variant | Students | CPU % of one core | Used heap range MiB | Peak RSS MiB | Peak sampled backend DB connections |
|---|---:|---:|---|---:|---:|
| before | 10 | 1.1 | 111.2–128.7 | 175.2 | 10 |
| before | 100 | 2.8 | 56.3–183.0 | 349.6 | 10 |
| before | 1000 | 8.5 | 163.6–265.5 | 470.6 | 10 |
| after | 10 | 0.9 | 110.2–125.9 | 171.8 | 10 |
| after | 100 | 0.9 | 183.6–269.1 | 400.4 | 10 |
| after | 1000 | 7.4 | 167.5–266.2 | 429.1 | 10 |

Pool decision: retain Hikari default maximum 10. This cadence produced no HTTP errors or connection timeouts; these measurements do not justify increasing the pool. Socket count does not imply one database connection per SSE subscriber. No application pool default was changed.

## SQL costs and individual changes

Isolated counts: **4 → 3 statements per normal heartbeat** (25% fewer) and **302 → 5 statements per 100-student overview** (98.3% fewer). The heartbeat still performs one session UPDATE; the saving is its interval SELECT.

`pg_stat_statements` records server execution (not lock/network/pool time). Workload snapshots include startup and warm-up SQL; HTTP percentiles above include steady state only. Dedicated probes isolate heartbeat and overview SQL calls.

| Variant | Probe | SQL | Calls | Mean execution ms |
|---|---|---|---:|---:|
| before | heartbeat | session update | 100 | 0.122 |
| before | heartbeat | account/assignment select | 100 | 0.034 |
| before | heartbeat | interval select | 100 | 0.020 |
| before | heartbeat | session select (row lock) | 100 | 0.039 |
| before | overview | session select | 1000 | 0.009 |
| before | overview | session select | 1000 | 0.011 |
| before | overview | interval select | 990 | 0.015 |
| before | overview | account/assignment select | 10 | 0.156 |
| before | overview | interval select | 10 | 0.113 |
| before | overview | account/assignment select | 10 | 0.030 |
| after | heartbeat | session update | 100 | 0.125 |
| after | heartbeat | account/assignment select | 100 | 0.050 |
| after | heartbeat | session select (row lock) | 100 | 0.044 |
| after | overview | session select | 10 | 0.148 |
| after | overview | account/assignment select | 10 | 0.040 |
| after | overview | account/assignment select | 10 | 0.177 |
| after | overview | session select | 10 | 0.315 |
| after | overview | interval select | 10 | 0.550 |

1. **Heartbeat:** normal measurable-state heartbeats no longer fetch the open interval only to compute a false `timedOut`. Row lock, authorization, timeout-before-verification and the single session UPDATE remain. No heartbeat event is inserted. UNKNOWN still reads its interval reason; camera-stop and timeout semantics are unchanged. Compare the isolated 100-heartbeat query counts and timing above.
2. **Daily report index:** V1 was left intact; `V2__interval_session_index.sql` adds `(session_id, started_at, id)` for closed as well as open intervals. `explain.sql` seeds 1,000 historical sessions and **200,000** nonoverlapping intervals (200/student), ANALYZEs, measures before/after in one transaction, then rolls back. Existing `(student_id, study_date)` still serves session-day lookup. Plan details follow.
Single-session interval execution improved from 5.886 ms (second warm baseline run) to 0.194 ms (second indexed run), about 30x in this fixture. The 100-student batch stayed around 38 ms and chose a sequential scan in both plans; no index speedup is claimed for that case. Day session lookup used the existing student/date index (0.033 ms).
3. **Teacher overview:** batches day sessions, intervals and active sessions across assigned students, preserving one repeatable-read snapshot, ordering, totals, streaks and previous-day live sessions. Reduces query growth from per-student queries to bounded queries; the dedicated overview SQL counts above isolate this change. Individual student reports share the same accounting function.
4. **SSE disconnect:** transport disconnects no longer go through the generic JSON ProblemDetail handler. A failed completion on an already invalid Tomcat async context is contained so it cannot abort fan-out to remaining subscribers. The first real reconnect probe exposed this exception and failed delivery before the fix; the repeated probe passes. The before/after server logs measure the error/converter failures below. Registry callbacks, infinite stream lifetime, 25-second pings and after-commit delivery remain.

### EXPLAIN ANALYZE (200,000 intervals)

```text
BEGIN
DROP INDEX
INSERT 0 1000
INSERT 0 1000
INSERT 0 200000
ANALYZE
ANALYZE
BEFORE: single-student day intervals (200 rows)
                                                               QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------------------
 Gather Merge  (cost=5587.13..5612.80 rows=220 width=113) (actual time=9.114..9.961 rows=200 loops=1)
   Workers Planned: 2
   Workers Launched: 2
   Buffers: shared hit=3616
   ->  Sort  (cost=4587.10..4587.38 rows=110 width=113) (actual time=2.552..2.554 rows=67 loops=3)
         Sort Key: started_at, id
         Sort Method: quicksort  Memory: 50kB
         Buffers: shared hit=3616
         Worker 0:  Sort Method: quicksort  Memory: 25kB
         Worker 1:  Sort Method: quicksort  Memory: 25kB
         ->  Parallel Seq Scan on activity_intervals  (cost=0.00..4583.38 rows=110 width=113) (actual time=0.048..2.372 rows=67 loops=3)
               Filter: (session_id = '2f3bf3e1-4bb3-8eca-2bba-254738891c56'::uuid)
               Rows Removed by Filter: 67733
               Buffers: shared hit=3524
 Planning:
   Buffers: shared hit=75
 Planning Time: 0.332 ms
 Execution Time: 9.984 ms
(18 rows)

                                                               QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------------------
 Gather Merge  (cost=5587.13..5612.80 rows=220 width=113) (actual time=4.806..5.866 rows=200 loops=1)
   Workers Planned: 2
   Workers Launched: 2
   Buffers: shared hit=3616
   ->  Sort  (cost=4587.10..4587.38 rows=110 width=113) (actual time=2.763..2.764 rows=67 loops=3)
         Sort Key: started_at, id
         Sort Method: quicksort  Memory: 41kB
         Buffers: shared hit=3616
         Worker 0:  Sort Method: quicksort  Memory: 29kB
         Worker 1:  Sort Method: quicksort  Memory: 29kB
         ->  Parallel Seq Scan on activity_intervals  (cost=0.00..4583.38 rows=110 width=113) (actual time=0.058..2.660 rows=67 loops=3)
               Filter: (session_id = '2f3bf3e1-4bb3-8eca-2bba-254738891c56'::uuid)
               Rows Removed by Filter: 67733
               Buffers: shared hit=3524
 Planning Time: 0.088 ms
 Execution Time: 5.886 ms
(16 rows)

BEFORE: batched 100-student teacher intervals (20000 rows)
                                                              QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=7532.74..7569.65 rows=14761 width=113) (actual time=36.570..37.114 rows=20000 loops=1)
   Sort Key: activity_intervals.started_at, activity_intervals.id
   Sort Method: quicksort  Memory: 3147kB
   Buffers: shared hit=3524
   ->  Hash Semi Join  (cost=2.25..6510.58 rows=14761 width=113) (actual time=0.189..31.987 rows=20000 loops=1)
         Hash Cond: (activity_intervals.session_id = (md5(('plan-session-'::text || (n.n)::text)))::uuid)
         Buffers: shared hit=3524
         ->  Seq Scan on activity_intervals  (cost=0.00..5558.00 rows=203400 width=113) (actual time=0.003..8.850 rows=203400 loops=1)
               Buffers: shared hit=3524
         ->  Hash  (cost=1.00..1.00 rows=100 width=4) (actual time=0.109..0.110 rows=100 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 12kB
               ->  Function Scan on generate_series n  (cost=0.00..1.00 rows=100 width=4) (actual time=0.012..0.015 rows=100 loops=1)
 Planning:
   Buffers: shared hit=5
 Planning Time: 0.133 ms
 Execution Time: 37.664 ms
(16 rows)

CREATE INDEX
ANALYZE
AFTER: single-student day intervals (200 rows)
                                                                      QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=475.97..476.31 rows=138 width=113) (actual time=0.257..0.262 rows=200 loops=1)
   Sort Key: started_at, id
   Sort Method: quicksort  Memory: 50kB
   Buffers: shared hit=200 read=4
   ->  Bitmap Heap Scan on activity_intervals  (cost=5.49..471.06 rows=138 width=113) (actual time=0.042..0.239 rows=200 loops=1)
         Recheck Cond: (session_id = '2f3bf3e1-4bb3-8eca-2bba-254738891c56'::uuid)
         Heap Blocks: exact=200
         Buffers: shared hit=200 read=4
         ->  Bitmap Index Scan on activity_intervals_session_start_idx  (cost=0.00..5.46 rows=138 width=0) (actual time=0.026..0.027 rows=200 loops=1)
               Index Cond: (session_id = '2f3bf3e1-4bb3-8eca-2bba-254738891c56'::uuid)
               Buffers: shared read=4
 Planning:
   Buffers: shared hit=45 read=1
 Planning Time: 0.272 ms
 Execution Time: 0.286 ms
(15 rows)

                                                                      QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=475.97..476.31 rows=138 width=113) (actual time=0.161..0.166 rows=200 loops=1)
   Sort Key: started_at, id
   Sort Method: quicksort  Memory: 50kB
   Buffers: shared hit=204
   ->  Bitmap Heap Scan on activity_intervals  (cost=5.49..471.06 rows=138 width=113) (actual time=0.032..0.145 rows=200 loops=1)
         Recheck Cond: (session_id = '2f3bf3e1-4bb3-8eca-2bba-254738891c56'::uuid)
         Heap Blocks: exact=200
         Buffers: shared hit=204
         ->  Bitmap Index Scan on activity_intervals_session_start_idx  (cost=0.00..5.46 rows=138 width=0) (actual time=0.017..0.017 rows=200 loops=1)
               Index Cond: (session_id = '2f3bf3e1-4bb3-8eca-2bba-254738891c56'::uuid)
               Buffers: shared hit=4
 Planning Time: 0.054 ms
 Execution Time: 0.194 ms
(13 rows)

AFTER: batched 100-student teacher intervals (20000 rows)
                                                              QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=7522.65..7559.29 rows=14654 width=113) (actual time=37.099..37.655 rows=20000 loops=1)
   Sort Key: activity_intervals.started_at, activity_intervals.id
   Sort Method: quicksort  Memory: 3147kB
   Buffers: shared hit=3524
   ->  Hash Semi Join  (cost=2.25..6508.67 rows=14654 width=113) (actual time=0.177..32.298 rows=20000 loops=1)
         Hash Cond: (activity_intervals.session_id = (md5(('plan-session-'::text || (n.n)::text)))::uuid)
         Buffers: shared hit=3524
         ->  Seq Scan on activity_intervals  (cost=0.00..5558.00 rows=203400 width=113) (actual time=0.005..9.237 rows=203400 loops=1)
               Buffers: shared hit=3524
         ->  Hash  (cost=1.00..1.00 rows=100 width=4) (actual time=0.092..0.093 rows=100 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 12kB
               ->  Function Scan on generate_series n  (cost=0.00..1.00 rows=100 width=4) (actual time=0.006..0.009 rows=100 loops=1)
 Planning:
   Buffers: shared hit=2
 Planning Time: 0.103 ms
 Execution Time: 38.166 ms
(16 rows)

Day sessions query
                                                                       QUERY PLAN
--------------------------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=8.31..8.32 rows=1 width=166) (actual time=0.021..0.022 rows=1 loops=1)
   Sort Key: started_at, id
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=3
   ->  Index Scan using study_sessions_student_date_idx on study_sessions  (cost=0.28..8.30 rows=1 width=166) (actual time=0.018..0.018 rows=1 loops=1)
         Index Cond: ((student_id = '38bd911c-874c-d319-a12b-97bec6c9e27c'::uuid) AND (study_date = (CURRENT_DATE - 1)))
         Buffers: shared hit=3
 Planning:
   Buffers: shared hit=89
 Planning Time: 0.280 ms
 Execution Time: 0.033 ms
(11 rows)

ROLLBACK
```

### SQL workload summary (1,000 students)

| Variant | SQL (top by total execution) | Calls | Mean ms | Max ms |
|---|---|---:|---:|---:|
| before | `update study_sessions` | 9401 | 0.139 | 13.928 |
| before | `select from activity_intervals ai1_0` | 7700 | 0.099 | 1.945 |
| before | `insert into activity_intervals (created_at,ended_at,opened_by_event_id,reason,session_id,started_at,` | 3400 | 0.215 | 3.282 |
| before | `select from users a1_0` | 11171 | 0.059 | 2.350 |
| before | `update activity_intervals` | 2400 | 0.260 | 10.138 |
| before | `update monitoring_events` | 4800 | 0.130 | 1.364 |
| before | `insert into monitoring_events (confidence,detected_at,effective_at,event_id,reason,response,seq,serv` | 3400 | 0.179 | 5.779 |
| before | `select from study_sessions ss1_0` | 9401 | 0.060 | 11.693 |
| after | `update study_sessions` | 9400 | 0.163 | 3.293 |
| after | `select from users a1_0` | 11170 | 0.086 | 1.755 |
| after | `insert into activity_intervals (created_at,ended_at,opened_by_event_id,reason,session_id,started_at,` | 3400 | 0.232 | 4.320 |
| after | `update activity_intervals` | 2400 | 0.280 | 8.726 |
| after | `update monitoring_events` | 4800 | 0.138 | 2.357 |
| after | `select from study_sessions ss1_0` | 9400 | 0.065 | 2.263 |
| after | `insert into monitoring_events (confidence,detected_at,effective_at,event_id,reason,response,seq,serv` | 3400 | 0.177 | 6.034 |
| after | `SELECT $2 FROM ONLY "public"."study_sessions" x WHERE "id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE O` | 11600 | 0.011 | 1.870 |

## SSE, disconnects and restart

- heapBeforeSse: 35.70 MiB used after explicit GC (outside timed workload).
- heapWith1000Sse: 148.37 MiB used after explicit GC (outside timed workload).
- heapAfterDisconnect: 52.51 MiB used after explicit GC (outside timed workload).
- Idle socket retained-heap delta: 115.38 KiB/socket for 1,000 sockets belonging to one user. **ESTIMATE of incremental socket cost**, not a per-student production sizing guarantee; shared caches, servlet objects, JIT and GC contribute.
- before workload disconnect logs: 682 generic backend errors; 682 SSE-to-JSON converter failures.
- after workload disconnect logs: 0 generic backend errors; 0 SSE-to-JSON converter failures.
- Controlled memory probe emitter counts: baseline 0, connected 1000; every-10-second counts after normal socket close: [1000, 1000, 1000, 1000, 0]. The probe refuses to run while any cohort SSE clients remain.
- A preliminary normal-close snapshot at 27 seconds still retained 1,000 emitters. That single snapshot was too early to infer a leak: a TCP FIN may need another write/ping to surface. The final controlled probe waits through multiple 25-second ping cycles and checks actual live emitter counts.
- PASS: refetch recovers missed AWAY; reconnected stream receives fresh FOCUS_ESTIMATED
- PASS: SIGKILL, 92 seconds offline, persisted ACTIVE session becomes UNKNOWN at exact verifiedUntil; focus interval closed there
- SSE delivery has no durable replay; reconnect refetch is required by the contract. The network probe closes a real socket, misses an event, reconnects, refetches state, and receives a new monitoring event.
- Completion/timeout/error callback tests repeat 100 disconnects each, verify registry count returns to zero, and verify a fresh subscriber receives subsequent events. A separate regression throws from both send and completeWithError and requires fan-out to continue. The before/after workload post-disconnect histograms also remain in ignored raw dumps.
- Fan-out remains synchronous after commit. This workload had no drops or growing backlog. Slow-reader/WAN backpressure, multi-instance fan-out and hours-long socket churn were not reproduced; their behavior is not inferred from this localhost test.

## Security and contract checks

- `./gradlew test --rerun-tasks`: **61 tests, 0 failures, 0 errors, 0 skipped**; original 36 retained, 25 additions. Testcontainers uses its own random port, not the coordinator DB.
- JWT modified payload with original signature, expired beyond allowed 60-second clock skew, `alg=none`, wrong issuer, missing expiry, future not-before all return 401.
- Students cannot use teacher routes; teachers cannot start or mutate student sessions; cross-student mutations/read and unassigned-teacher reads return 403. Both stream role checks are exercised.
- Invalid enum, missing state, seq=0, invalid confidence/score, uncontracted media, server-only reason are rejected without writes. Existing validation/privacy assertions remain.
- Future detectedAt >5 seconds rejected; far-past/pre-session detectedAt clamps to current interval/session start. Original exact duplicate HTTP concurrency, new concurrent distinct-event/same-seq collision, sequence gaps/order and cross-session event ID tests pass.
- Camera stop prevents further focus; after the explicit 45-second live grace, silent focus reports cap at verifiedUntil, and timeout closes there. The report may temporarily display up to 45 seconds beyond verifiedUntil while the client is considered live; this is explicitly required by state-machine §5.
- `V1__init.sql`, OpenAPI and all other contracts unchanged; 12 operationIds remain. No endpoint or request/response field was added.

## Unresolved accounting rule

The real post-restart probe measured **0 seconds** of extra focus with event-first ordering. A separate fixture seeded a timed-out UNKNOWN session with 30 seconds of closed focus; a **fresh heartbeat followed by an old queued focus event** then measured **90 extra focus seconds** (30 → 120). The heartbeat advances verification, then the event clamps to the UNKNOWN interval's old start (verifiedUntil). This follows the explicit max(detectedAt,currentInterval.startedAt) formula but conflicts with the prose that offline time stays UNKNOWN. Changing recovery accounting requires C0 to clarify state-machine §4; this part was not silently changed. Proposed rule: after HEARTBEAT_TIMEOUT, an event whose detectedAt precedes server receipt must preserve the timeout UNKNOWN gap and restore measurable state only at receipt (or use another explicit approved recovery boundary). No new wire field is needed.

## Reproduction and limitations

See `README.md`, `run.py`, `probe.py`, `memory_probe.py`, `extra_probes.py`, `explain.sql`, and `render_results.py`. The controlled extra script pauses only this runner after its measured cohorts, repeats the discarded 100-student window, and preserves SQL snapshots. The final memory/recovery fixture runs on a fresh isolated server/database with zero cohort clients; no probe activity enters the reported steady windows. Raw dumps are intentionally ignored under `results/raw/`; do not publish environment.json. Docker container `sm-loadtest-pg` and every backend started by these scripts are removed/stopped on completion. No secret is committed.

One machine, one valid three-minute steady run per cohort/variant and warmed JVM/DB caches limit causality for latency changes. The initial after-100 window overlapped a memory probe and was discarded. Its clean replacement ran after after-1000, so the candidate 100-student run has additional JVM warm-up; no latency causality is assigned solely to that run. Query-count reductions and the transaction-local index plans provide direct per-change evidence; combined HTTP latency changes include all optimizations. No 1,000-user extrapolation was used. Login saturation, internet latency, browser rendering, long-term production capacity, and untested slow readers remain outside this measurement.
