# Isolated Phase 2 load test

Requires Java 21, Docker, Python 3, and the backend Gradle wrapper. No additional library is installed.
Never targets the coordinator's ports 8080/5433. The runner binds PostgreSQL to **127.0.0.1:5434** and
starts the backend on **18080**. It refuses an existing container named `sm-loadtest-pg`.

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
cd backend
./gradlew bootJar loadtestClasses
python3 loadtest/run.py /absolute/path/to/baseline.jar
```

The runner creates random DB/JWT secrets in process environment variables; a mode-0600 local
`results/raw/environment.json` permits additional isolated probes. Everything in `results/raw/` is
gitignored. Never publish that directory wholesale. The container is removed in `finally` on normal
completion/errors (after a force-kill, manually remove **only** `sm-loadtest-pg`).

The runner first executes baseline 10/100/1000-user scenarios. Before launching, build the desired
baseline jar. The server runs from immutable artifact copies, so rebuilding is safe. When `results/raw/baseline-complete` appears, build the optimized jar and create
`results/raw/continue`. It then repeats the same scenarios and removes its container. Remove old
marker files before a fresh run. To compare a different baseline, use a separately built jar; do not
revert or alter another agent's worktree.

The Java driver uses one virtual thread per student, one real HTTP/1.1 SSE socket per student, and
one teacher SSE socket per 100 students (minimum one). It seeds users and assignments directly into
its own database and issues HS256 JWTs with the environment secret; BCrypt/login cost is therefore
excluded. Each student starts a session and establishes focus. After setup: 30-second warm-up,
180-second measured steady state; heartbeat every 30 s, staggered independently; 20% transition
every 30 s; 10% fetch their report every 30 s; each teacher fetches the overview every 30 s.

Raw JSON records each endpoint's request count, failures and latency percentiles. Resource samples
are every 10 s: backend `ps` CPU/RSS/process CPU time, `jcmd GC.heap_info` heap, PostgreSQL
`pg_stat_activity` state counts. `pg_stat_statements` records calls, mean/max SQL execution time.
`ps %cpu` is an OS rolling average; derive scenario CPU from process CPU-time deltas for comparisons.
SSE reports live sockets, unexpected drops/reconnects, received events and event delivery delay
(`receive time - event.at`). Here onsets are current timestamps; deliberately backdated events in
other workloads would mix evidence onset age with network delay. Metrics use a shared host clock.

Only steady-state finite HTTP requests enter throughput/latency/error metrics. Session creation and
initial SSE establishment occur before measurement; SSE event counts/delay are separate. Startup
burst, BCrypt login throughput, WAN/browser behavior, long-lived JWT expiry and multi-instance
fan-out are outside these results. A closed-loop user waits for its request; the cadence is realistic
for monitoring, not a saturation benchmark. Quantiles use nearest rank without a histogram dependency.

During the baseline pause, the following optional probes leave the DB in place and stop their own
backend processes before returning. `probe.py after` takes about 3 minutes (1,000 sockets, reconnect,
then SIGKILL and 92 seconds offline before restart). Run them sequentially, outside measured scenarios.

```sh
docker exec -i sm-loadtest-pg psql -U study_monitor -d study_monitor < loadtest/explain.sql > loadtest/results/raw/explain.txt
python3 loadtest/probe.py before loadtest/results/raw/before-server.jar
python3 loadtest/probe.py after build/libs/study-monitor-backend-0.0.1-SNAPSHOT.jar
touch loadtest/results/raw/continue
```

`explain.sql` inserts 200,000 historical intervals and compares query plans before/after the candidate
index, then rolls back the fixture and index. Probe JSON includes 30 session-start request timings,
100 heartbeat timings plus exact SQL calls, and 10 teacher-overview timings plus SQL calls. These
microbenchmarks are separate from the steady workloads; startup/JIT and sequential local requests
limit latency comparisons. The retained-heap SSE probe uses one user with 1,000 sockets to avoid
changing business data; it is not an exact estimate of heap per distinct student under active load.
