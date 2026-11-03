#!/usr/bin/env python3
"""Run outside steady windows: pause our runner after 1,000, optionally repeat 100, then resume it."""
import base64,hashlib,hmac,http.client,json,os,pathlib,re,shlex,shutil,signal,subprocess as sp,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[1];RAW=ROOT/'loadtest/results/raw'
env=json.loads((RAW/'environment.json').read_text());java=env['JAVA_HOME']+'/bin/jcmd'
# Discover only the explicit local run.py launched for this worktree; do not signal other workers.
rows=sp.check_output(['ps','-Ao','pid,args'],text=True).splitlines()
runners=[int(row.split()[0]) for row in rows if any(arg.endswith('loadtest/run.py') for arg in shlex.split(row)[1:])]
if len(runners)!=1: raise RuntimeError('Expected exactly our load-test runner')
runner=runners[0]
while not (RAW/'after-1000.json').exists():time.sleep(0.1)
os.kill(runner,signal.SIGSTOP)
try:
    # Metrics JSON is written before driver teardown; wait until that child exits.
    for _ in range(90):
        children=sp.check_output(['ps','-Ao','ppid,args'],text=True).splitlines()
        if not any(line.split()[0]==str(runner) and 'com.studymonitor.loadtest.LoadTest ' in line for line in children): break
        time.sleep(1)
    else: raise RuntimeError('Load driver did not exit; refusing extra probes')
    pid=int((RAW/'backend.pid').read_text())
    expected=sp.check_output(['ps','-p',str(pid),'-o','args='],text=True)
    assert str(RAW/'after-server.jar') in expected,'Not our isolated server'
    def sql(query):return sp.check_output(['docker','exec','sm-loadtest-pg','psql','-U','study_monitor','-d','study_monitor','-Atc',query],text=True)
    preserved=RAW/'after-1000-queries-preserved.csv'
    preserved.write_text(sql("copy (select calls,round(mean_exec_time::numeric,3) mean_ms,round(max_exec_time::numeric,3) max_ms,rows,query from pg_stat_statements where query not like '%pg_stat%' order by total_exec_time desc limit 40) to stdout with csv header"))
    # The earlier 100-user window overlapped a probe and is explicitly discarded.
    import shutil
    discarded=RAW/'discarded/after-100-overlapped-probe';discarded.mkdir(parents=True,exist_ok=True)
    for f in RAW.glob('after-100.*'): shutil.move(f,discarded/f.name)
    for suffix in ['resources.json','queries.csv']:
        f=RAW/('after-100-'+suffix)
        if f.exists():shutil.move(f,discarded/f.name)
    full_env={**os.environ,**env}
    cp=sp.check_output([str(ROOT/'gradlew'),'-q','-p',str(ROOT),'loadtestClasspath'],env=full_env,text=True).strip().splitlines()[-1]
    sql('select pg_stat_statements_reset()')
    with (RAW/'after-100.log').open('w') as out:
        driver=sp.Popen([env['JAVA_HOME']+'/bin/java','-Xmx768m','-cp',cp,'com.studymonitor.loadtest.LoadTest','100','180','after'],cwd=ROOT,env=full_env,stdout=out,stderr=sp.STDOUT)
        samples=[]
        while driver.poll() is None:
            samples.append({'at':time.time(),'ps':sp.check_output(['ps','-p',str(pid),'-o','pid,%cpu,rss,time'],text=True),'heap':sp.check_output([java,str(pid),'GC.heap_info'],text=True),'connections':sql("select state,count(*) from pg_stat_activity where datname='study_monitor' group by state")})
            (RAW/'after-100-resources.json').write_text(json.dumps(samples,indent=2));time.sleep(10)
        assert driver.returncode==0,'Repeated 100-user scenario failed'
    (RAW/'after-100-queries.csv').write_text(sql("copy (select calls,round(mean_exec_time::numeric,3) mean_ms,round(max_exec_time::numeric,3) max_ms,rows,query from pg_stat_statements where query not like '%pg_stat%' order by total_exec_time desc limit 40) to stdout with csv header"))
    print('Clean repeated after-100 scenario complete',flush=True)

    user='99990000-0000-0000-0000-000000000001';session='99990000-0000-0000-0000-000000000002'
    sql(f"""BEGIN;
    INSERT INTO users VALUES ('{user}','gap@test.local','unused','Gap probe','STUDENT',now());
    INSERT INTO study_sessions(id,student_id,status,study_date,started_at,current_state,current_state_since,last_seq,last_heartbeat_at,verified_until,created_at)
    VALUES ('{session}','{user}','ACTIVE',(now() at time zone 'Asia/Seoul')::date,now()-interval '120 seconds','UNKNOWN',now()-interval '90 seconds',0,now()-interval '90 seconds',now()-interval '90 seconds',now());
    INSERT INTO activity_intervals(id,session_id,student_id,state,reason,started_at,ended_at,created_at) VALUES
    (gen_random_uuid(),'{session}','{user}','FOCUS_ESTIMATED','SEATED_CONFIRMED',now()-interval '120 seconds',now()-interval '90 seconds',now()),
    (gen_random_uuid(),'{session}','{user}','UNKNOWN','HEARTBEAT_TIMEOUT',now()-interval '90 seconds',NULL,now()); COMMIT;""")
    encode=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=').decode()
    data=encode(b'{"alg":"HS256"}')+'.'+encode(json.dumps(dict(iss='study-monitor',sub=user,role='STUDENT',iat=int(time.time()),exp=int(time.time())+3600)).encode())
    jwt=data+'.'+encode(hmac.new(env['JWT_SECRET'].encode(),data.encode(),hashlib.sha256).digest())
    def request(path,body=None):
        c=http.client.HTTPConnection('localhost',18080,timeout=10)
        try:
            c.request('GET' if body is None else 'POST',path,None if body is None else json.dumps(body),{'Authorization':'Bearer '+jwt,'Content-Type':'application/json'})
            r=c.getresponse();b=r.read();assert r.status==200,(r.status,b);return json.loads(b)
        finally:c.close()
    path='/api/v1/study-sessions/'+session;s=request(path);report='/api/v1/me/study-days/'+s['studyDate']
    before=request(report)['totals']['focusSeconds']
    request(path+'/heartbeat',dict(sentAt=s['startedAt'],clientState='FOCUS_ESTIMATED',cameraActive=True,pageVisible=True,lastSeq=0))
    transition=request(path+'/transitions',dict(eventId=str(uuid.uuid4()),seq=1,state='FOCUS_ESTIMATED',reason='RECONNECTED',detectedAt=s['startedAt']))
    after=request(report)['totals']['focusSeconds']
    output={'heartbeatThenQueuedEvent':{'beforeFocusSeconds':before,'afterFocusSeconds':after,'extraFocusSeconds':after-before,'effectiveAt':transition['effectiveAt'],'oldVerifiedUntil':s['verifiedUntil']}}
    print('Recovery ordering probe extra focus seconds:',after-before,flush=True)
    def hist():return sp.check_output([java,str(pid),'GC.class_histogram'],text=True)
    def count(h):
        rows=[line for line in h.splitlines() if re.search(r'\sorg.springframework.web.servlet.mvc.method.annotation.SseEmitter(?:\s|$)',line)]
        return int(rows[0].split()[1]) if rows else 0
    def heap():
        sp.check_output([java,str(pid),'GC.run']);return sp.check_output([java,str(pid),'GC.heap_info'],text=True)
    time.sleep(27)
    for _ in range(10):
        output['baselineEmitterCount']=count(hist())
        if output['baselineEmitterCount']==0:break
        time.sleep(10)
    assert output['baselineEmitterCount']==0,'Refuse memory probe while other SSE clients remain'
    output['heapBeforeSse']=heap();sockets=[]
    for _ in range(1000):
        c=http.client.HTTPConnection('localhost',18080,timeout=10);c.request('GET','/api/v1/me/stream',headers={'Authorization':'Bearer '+jwt});r=c.getresponse();assert r.status==200;r.readline();r.readline();sockets.append((c,r))
    output['heapWith1000Sse']=heap();output['emitterCountWith1000']=count(hist())
    for c,r in sockets:
        r.close();c.close()
    del sockets,c,r
    samples=[]
    for _ in range(8):
        time.sleep(10);n=count(hist());samples.append(n)
        if n==0:break
    output['postDisconnectEmitterCounts']=samples;output['heapAfterDisconnect']=heap()
    (RAW/'extra-probes.json').write_text(json.dumps(output,indent=2))
    assert samples[-1]==0,output
    print('Idle SSE retained heap/cleanup probe PASS',flush=True)
finally:
    os.kill(runner,signal.SIGCONT)
    # The old runner takes its SQL snapshot after driver exit. Restore the snapshot captured
    # before extra probes, after it has completed cleanup, rather than mislabeling probe SQL.
    for _ in range(90):
        try:os.kill(runner,0)
        except ProcessLookupError:break
        time.sleep(1)
    if 'preserved' in globals() and preserved.exists():shutil.copyfile(preserved,RAW/'after-1000-queries.csv')

