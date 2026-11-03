#!/usr/bin/env python3
"""Render a sanitized, reviewable report; never copy the local credential file."""
import csv,io,json,math,pathlib,re,statistics
from datetime import datetime
ROOT=pathlib.Path(__file__).resolve().parent;RAW=ROOT/'results/raw'

def load(name):return json.loads((RAW/name).read_text())
def q(values,p):return sorted(values)[min(len(values)-1,math.ceil(len(values)*p)-1)]
def cpu_time(ps):
    parts=ps.splitlines()[-1].split()[-1].split(':');return sum(float(x)*60**i for i,x in enumerate(reversed(parts)))
def resources(label,users):
    samples=load(f'{label}-{users}-resources.json')
    log=(RAW/f'{label}-{users}.log').read_text();stamp=re.search(r'STEADY (\S+)',log)[1]
    begin=datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()
    steady=[s for s in samples if begin<=s['at']<=begin+180]
    first,last=steady[0],steady[-1]
    cpu=(cpu_time(last['ps'])-cpu_time(first['ps']))/(last['at']-first['at'])*100
    used=[int(re.search(r'heap\s+total\s+\d+K,\s+used\s+(\d+)K',s['heap'])[1])/1024 for s in steady]
    rss=[int(s['ps'].splitlines()[-1].split()[2])/1024 for s in steady]
    connections=[sum(int(row.split('|')[1]) for row in s['connections'].splitlines())-1 for s in steady]
    return f'{cpu:.1f}',f'{min(used):.1f}–{max(used):.1f}',f'{max(rss):.1f}',max(connections)

lines=['# Phase 2 backend load, security and reliability results','',
'Run date: 2026-11-03. Baseline: integration `d9951a7`; candidate: heartbeat query removal, batched teacher overview, V2 interval index, and SSE disconnect/fan-out fixes. No API/schema wire changes. All numbers below are measured on this machine; none is an extrapolation.','',
'**Resolved in P2-W2b (verified 2026-11-04 Asia/Seoul):** C0 approved timeout recovery in `d7cacc8`; leaving UNKNOWN opened by HEARTBEAT_TIMEOUT now takes effect at server receipt. Offline focus credit improved from **90 seconds to 0 seconds**. All **71 tests** pass, retaining the previous 61 and adding four recovery plus six database-upgrade cases; see [CONTRACT_CHANGE_REQUEST.md](CONTRACT_CHANGE_REQUEST.md). The load numbers below are the historical P2-W2 measurements, not a rerun of load scenarios after this follow-up.','',
'## Workload and environment','',
'- macOS 15.8.1 arm64, Mac16,8, 14 logical CPUs, 24 GiB RAM; Java 21.0.9; PostgreSQL 17.11 in Docker. Shared developer machine, not a dedicated performance host.',
'- Separate backend on 18080 and PostgreSQL on 127.0.0.1:5434. Backend JVM `-Xms256m -Xmx768m`; default Hikari maximum 10. No coordinator services were used.',
'- Each cohort really ran 10/100/1,000 virtual-thread students, one student SSE each, and 1/1/10 teacher SSE subscribers. Pre-issued JWTs exclude BCrypt/login. All start sessions and establish focus before warm-up.',
'- Per cohort: 30 s warm-up plus 180 s steady state. Every student sends a heartbeat every 30 s, 20% transition every 30 s, 10% read their day report every 30 s, each teacher reads an overview every 30 s. Cadence is staggered; users wait for each request.',
'- Throughput is the offered monitoring workload, not the maximum server capacity. SSE events are counted separately. Latency is complete HTTP round-trip time on localhost, nearest-rank quantiles. Small cohorts have only six overview samples, so p95/p99 often equal their maximum.',
'- Both variants run immutable jar copies. One earlier in-place jar-rebuild run was discarded completely; its files remain only in ignored `raw/discarded/`.','',
'## Headline measurements','',
'| Variant | Students | Steady s | HTTP req/s | HTTP errors | Heartbeat p95 ms | Overview p95 ms | SSE live/expected | SSE drops/reconnects | SSE delay p95 ms |',
'|---|---:|---:|---:|---:|---:|---:|---|---|---:|']
for label in ['before','after']:
    for n in [10,100,1000]:
        d=load(f'{label}-{n}.json');e=d['endpoints'];s=d['sse'];total=sum(x['count'] for x in e.values());errors=sum(x['errors'] for x in e.values())
        lines.append(f"| {label} | {n} | {d['steadySeconds']:.1f} | {d['requestsPerSecond']:.3f} | {errors}/{total} ({errors/total*100:.2f}%) | {e['heartbeat']['p95']:.2f} | {e['overview']['p95']:.2f} | {s['connected']}/{s['expected']} | {s['drops']}/{s['reconnects']} | {s['deliveryDelayMs']['p95']:.1f} |")
lines+=['','## Endpoint latency','', '| Variant | Students | Endpoint | Requests | p50 ms | p95 ms | p99 ms | Errors |','|---|---:|---|---:|---:|---:|---:|---:|']
for label in ['before','after']:
    for n in [10,100,1000]:
        for endpoint,e in load(f'{label}-{n}.json')['endpoints'].items():
            lines.append(f"| {label} | {n} | {endpoint} | {e['count']} | {e['p50']:.2f} | {e['p95']:.2f} | {e['p99']:.2f} | {e['errors']} |")
lines+=['','Session-start latency was measured separately in the isolated microprobe (30 requests per variant). This is sequential session replacement, not the cohort startup burst.','', '| Variant | Start p50/p95/p99 ms | Heartbeat p50/p95/p99 ms (100 requests) | Overview p50/p95/p99 ms (10 requests, 100 assigned students) |','|---|---|---|---|']
for label in ['before','after']:
    p=load(label+'-probe.json');cells=[' / '.join(f'{q(p[key],quant):.2f}' for quant in [.5,.95,.99]) for key in ['startLatencyMs','heartbeatLatencyMs','overviewLatencyMs']]
    lines.append('| '+label+' | '+' | '.join(cells)+' |')
lines+=['','## Backend and PostgreSQL resources','',
'CPU is process CPU-time delta / sampled elapsed time during steady state, expressed as percent of one logical CPU (100% = one core). Heap is sampled **used** heap without forcing GC during load; ranges include garbage and are not retained-memory measurements. RSS is sampled peak. PostgreSQL counts subtract the observer connection. Samples are every 10 s and can miss short spikes.','',
'| Variant | Students | CPU % of one core | Used heap range MiB | Peak RSS MiB | Peak sampled backend DB connections |','|---|---:|---:|---|---:|---:|']
for label in ['before','after']:
    for n in [10,100,1000]:lines.append('| '+label+' | '+str(n)+' | '+' | '.join(map(str,resources(label,n)))+' |')
lines+=['','Pool decision: retain Hikari default maximum 10. This cadence produced no HTTP errors or connection timeouts; these measurements do not justify increasing the pool. Socket count does not imply one database connection per SSE subscriber. No application pool default was changed.','',
'## SQL costs and individual changes','',
'Isolated counts: **4 → 3 statements per normal heartbeat** (25% fewer) and **302 → 5 statements per 100-student overview** (98.3% fewer). The heartbeat still performs one session UPDATE; the saving is its interval SELECT.','',
'`pg_stat_statements` records server execution (not lock/network/pool time). Workload snapshots include startup and warm-up SQL; HTTP percentiles above include steady state only. Dedicated probes isolate heartbeat and overview SQL calls.','',
'| Variant | Probe | SQL | Calls | Mean execution ms |','|---|---|---|---:|---:|']
for label in ['before','after']:
    p=load(label+'-probe.json')
    for probe in ['heartbeat','overview']:
        for row in csv.DictReader(io.StringIO(p[probe+'Queries'])):
            query=row['query'];desc=None
            if 'from activity_intervals' in query:desc='interval select'
            elif 'from study_sessions' in query:desc='session select'+(' (row lock)' if 'for no key update' in query else '')
            elif query.startswith('update study_sessions'):desc='session update'
            elif 'from users' in query:desc='account/assignment select'
            if desc: lines.append(f"| {label} | {probe} | {desc} | {row['calls']} | {row['round']} |")
lines+=['',
'1. **Heartbeat:** normal measurable-state heartbeats no longer fetch the open interval only to compute a false `timedOut`. Row lock, authorization, timeout-before-verification and the single session UPDATE remain. No heartbeat event is inserted. UNKNOWN still reads its interval reason; camera-stop and timeout semantics are unchanged. Compare the isolated 100-heartbeat query counts and timing above.',
'2. **Daily report index:** V1 was left intact; `V2__interval_session_index.sql` adds `(session_id, started_at, id)` for closed as well as open intervals. `explain.sql` seeds 1,000 historical sessions and **200,000** nonoverlapping intervals (200/student), ANALYZEs, measures before/after in one transaction, then rolls back. Existing `(student_id, study_date)` still serves session-day lookup. Plan details follow.',
'Single-session interval execution improved from 5.886 ms (second warm baseline run) to 0.194 ms (second indexed run), about 30x in this fixture. The 100-student batch stayed around 38 ms and chose a sequential scan in both plans; no index speedup is claimed for that case. Day session lookup used the existing student/date index (0.033 ms).',
'3. **Teacher overview:** batches day sessions, intervals and active sessions across assigned students, preserving one repeatable-read snapshot, ordering, totals, streaks and previous-day live sessions. Reduces query growth from per-student queries to bounded queries; the dedicated overview SQL counts above isolate this change. Individual student reports share the same accounting function.',
'4. **SSE disconnect:** transport disconnects no longer go through the generic JSON ProblemDetail handler. A failed completion on an already invalid Tomcat async context is contained so it cannot abort fan-out to remaining subscribers. The first real reconnect probe exposed this exception and failed delivery before the fix; the repeated probe passes. The before/after server logs measure the error/converter failures below. Registry callbacks, infinite stream lifetime, 25-second pings and after-commit delivery remain.','',
'### EXPLAIN ANALYZE (200,000 intervals)','', '```text']
# Plans contain only synthetic fixture IDs and SQL, no credentials.
plan=(RAW/'explain.txt').read_text(); lines+=[line.rstrip() for line in plan.splitlines()]+['```','', '### SQL workload summary (1,000 students)','', '| Variant | SQL (top by total execution) | Calls | Mean ms | Max ms |','|---|---|---:|---:|---:|']
for label in ['before','after']:
    rows=list(csv.DictReader((RAW/f'{label}-1000-queries.csv').open()))[:8]
    for row in rows:
        query=row['query'];short=query[:query.index(' set ')] if ' set ' in query else query[:100]
        if 'from ' in query: short='select from '+query.split('from ',1)[1].split(' where ',1)[0]
        lines.append(f"| {label} | `{short}` | {row['calls']} | {row['mean_ms']} | {row['max_ms']} |")
lines+=['','## SSE, disconnects and restart','']
p=load('after-probe.json');memory=load('memory-probe.json')
assert memory.get('result')=='PASS','Memory/cleanup probe must finish successfully before reporting'
for key in ['heapBeforeSse','heapWith1000Sse','heapAfterDisconnect']:
    used=int(re.search(r'heap\s+total\s+\d+K,\s+used\s+(\d+)K',memory[key])[1]);lines.append(f'- {key}: {used/1024:.2f} MiB used after explicit GC (outside timed workload).')
used=lambda key:int(re.search(r'heap\s+total\s+\d+K,\s+used\s+(\d+)K',memory[key])[1])
lines.append(f"- Idle socket retained-heap delta: {(used('heapWith1000Sse')-used('heapBeforeSse'))/1000:.2f} KiB/socket for 1,000 sockets belonging to one user. **ESTIMATE of incremental socket cost**, not a per-student production sizing guarantee; shared caches, servlet objects, JIT and GC contribute.")
for label in ['before','after']:
    log=(RAW/(label+'-server.log')).read_text();lines.append(f"- {label} workload disconnect logs: {log.count('Unhandled backend error')} generic backend errors; {log.count('No converter for')} SSE-to-JSON converter failures.")
lines.append(f"- Controlled memory probe emitter counts: baseline {memory['baselineEmitterCount']}, connected {memory['emitterCountWith1000']}; every-10-second counts after normal socket close: {memory['postDisconnectEmitterCounts']}. The probe refuses to run while any cohort SSE clients remain.")
lines.append('- A preliminary normal-close snapshot at 27 seconds still retained 1,000 emitters. That single snapshot was too early to infer a leak: a TCP FIN may need another write/ping to surface. The final controlled probe waits through multiple 25-second ping cycles and checks actual live emitter counts.')
lines+=['- '+p['networkLossReconnect'],'- '+p['abruptRestart'],
'- SSE delivery has no durable replay; reconnect refetch is required by the contract. The network probe closes a real socket, misses an event, reconnects, refetches state, and receives a new monitoring event.',
'- Completion/timeout/error callback tests repeat 100 disconnects each, verify registry count returns to zero, and verify a fresh subscriber receives subsequent events. A separate regression throws from both send and completeWithError and requires fan-out to continue. The before/after workload post-disconnect histograms also remain in ignored raw dumps.',
'- Fan-out remains synchronous after commit. This workload had no drops or growing backlog. Slow-reader/WAN backpressure, multi-instance fan-out and hours-long socket churn were not reproduced; their behavior is not inferred from this localhost test.','',
'## Security and contract checks','',
'- P2-W2 baseline: 61 passing tests (original 36 plus 25 additions). P2-W2b `./gradlew test`: **71 tests, 0 failures, 0 errors, 0 skipped**; all 61 retained plus four recovery regressions using the injected Clock and six migration/boot cases. Testcontainers uses its own random port, not the coordinator DB.',
'- JWT modified payload with original signature, expired beyond allowed 60-second clock skew, `alg=none`, wrong issuer, missing expiry, future not-before all return 401.',
'- Students cannot use teacher routes; teachers cannot start or mutate student sessions; cross-student mutations/read and unassigned-teacher reads return 403. Both stream role checks are exercised.',
'- Invalid enum, missing state, seq=0, invalid confidence/score, uncontracted media, server-only reason are rejected without writes. Existing validation/privacy assertions remain.',
'- Future detectedAt >5 seconds rejected; far-past/pre-session detectedAt clamps to current interval/session start. Original exact duplicate HTTP concurrency, new concurrent distinct-event/same-seq collision, sequence gaps/order and cross-session event ID tests pass.',
'- Camera stop prevents further focus; after the explicit 45-second live grace, silent focus reports cap at verifiedUntil, and timeout closes there. The report may temporarily display up to 45 seconds beyond verifiedUntil while the client is considered live; this is explicitly required by state-machine §5.',
'- `V1__init.sql` and wire shapes remain unchanged; 12 operationIds remain. P2-W2b merged the contract prose approved by C0 from `d7cacc8` via integration `8125abc`; W2 made no contract edits. No endpoint or request/response field was added.','',
 '## Recovery accounting — resolved in P2-W2b','',
'C0 approved the recovery exception in `d7cacc8`; W2 merged integration `8125abc` before implementing it. After timeout detection and validation, an accepted state-changing transition out of UNKNOWN opened by HEARTBEAT_TIMEOUT now uses `effectiveAt = serverNow`, regardless of client reason or detectedAt. Other intervals keep the ordinary clamp. Duplicate replay still returns the stored response before any timeout/boundary calculation.',
'',
'| Case | Before P2-W2b | After P2-W2b |',
'|---|---|---|',
'| Heartbeat first, then old queued focus event | +90 s offline focus in the real isolated fixture (30 → 120 focus s) | +0 s offline focus; 30 focus s and 90 UNKNOWN s in the injected-Clock regression |',
'| Old event first, then heartbeat | +0 s in the real restart probe, but the event used the old boundary | +0 s; event effectiveAt is server receipt, including when inline timeout detection runs before the scanner |',
'| UNKNOWN from session start or CAMERA_STOPPED | Ordinary clamp | Preserved: before-session onset clamps to start; later onset can still backdate within a non-timeout UNKNOWN interval |',
'| Recovery event replay after a later state change | Stored response replay | Identical stored boundary/response except duplicate=true; no event/interval/session mutation |',
'',
'The new outage fixtures use 90 seconds plus one microsecond to cross the strict timeout threshold while reporting exactly 90 whole UNKNOWN seconds. The queued onset is inside the outage. Both orderings retain the 30 previously verified focus seconds and add zero focus for the outage; the heartbeat-first case then accrues only ten newly verified focus seconds. A non-RECONNECTED client reason is also tested to prevent bypassing the recovery boundary.',
'',
'Before implementation, the targeted four-test run reported `4 tests completed, 3 failed`: both recovery boundaries and the duplicate-boundary assertion reproduced the old behavior, while ordinary UNKNOWN clamping passed. After the recovery implementation the suite passed 65/65; with the six migration cases included, the final full suite passes 71/71. Historical raw load/probe data remains untouched; no load-scenario or CPU/heap improvement is attributed to this accounting-only follow-up.',
'',
'## Existing demo database upgrade — resolved in P2-W2b','',
'Decision: enable `spring.flyway.out-of-order: true` by default in backend application.yml. The seed migration is intentionally V1000, so an existing seeded database can have a higher applied version than the new schema migration V2. Without out-of-order migration, current startup validation rejects pending V2; the legacy-database regression reproduced `Detected resolved migration not applied to database: 2` before the fix.',
'',
'With this default, Flyway validates and applies the pending V2 index once even when V1000 is already in history. A database where C0 already applied V2 out of order validates without applying it again. This keeps the required `V2__interval_session_index.sql` filename, its SQL, V1 and V1000 checksums unchanged. No repair, clean, baseline, history rewrite, ignored-pending validation, manual flag or data deletion is used by application startup. Normal Flyway validation stays enabled.',
'',
'| Testcontainers boot case | Expected successful migration history (installation order) | Data check |',
'|---|---|---|',
'| Existing V1 + V1000; seed enabled | 1, 1000, 2 | Existing accounts, assignments, modified display name, session and interval rows unchanged |',
'| Existing V1 + V1000; seed disabled | 1, 1000, 2 | Same existing data preserved; no seed rerun |',
'| V2 already applied out of order after V1000 | 1, 1000, 2 | Startup validates; no second application; existing data unchanged |',
'| Fresh demo database | 1, 2, 1000 | Five demo accounts and three assignments |',
'| Fresh seedless database | 1, 2 | Zero demo accounts |',
'| Existing seedless V1 database | 1, 2 | Upgrade succeeds with zero demo accounts |',
'',
'`MigrationUpgradeTests` copies the actual V1/V1000 migration bytes into an isolated legacy fixture location, migrates that schema first, then boots the current application bean graph with its real configuration and migrations. The servlet context is mocked, so no HTTP service port is opened. It excludes other test configurations and verifies the application JDBC URL points at the prepared Testcontainers database, preventing a shared ServiceConnection fixture from silently substituting a fresh DB. Existing-row snapshots are compared before and after boot. The default also allows later low-numbered schema migrations to reach already-seeded demo databases; all applied migration checksums remain immutable.',
'', '## Reproduction and limitations','',
'See `README.md`, `run.py`, `probe.py`, `memory_probe.py`, `extra_probes.py`, `explain.sql`, and `render_results.py`. The controlled extra script pauses only this runner after its measured cohorts, repeats the discarded 100-student window, and preserves SQL snapshots. The final memory/recovery fixture runs on a fresh isolated server/database with zero cohort clients; no probe activity enters the reported steady windows. Raw dumps are intentionally ignored under `results/raw/`; do not publish environment.json. Docker container `sm-loadtest-pg` and every backend started by these scripts are removed/stopped on completion. No secret is committed.',
'',
'One machine, one valid three-minute steady run per cohort/variant and warmed JVM/DB caches limit causality for latency changes. The initial after-100 window overlapped a memory probe and was discarded. Its clean replacement ran after after-1000, so the candidate 100-student run has additional JVM warm-up; no latency causality is assigned solely to that run. Query-count reductions and the transaction-local index plans provide direct per-change evidence; combined HTTP latency changes include all optimizations. No 1,000-user extrapolation was used. Login saturation, internet latency, browser rendering, long-term production capacity, and untested slow readers remain outside this measurement.']
(ROOT/'RESULTS.md').write_text('\n'.join(lines)+'\n')
print('Wrote loadtest/RESULTS.md')
