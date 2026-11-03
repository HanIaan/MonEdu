#!/usr/bin/env python3
"""Fresh isolated stack: retained SSE memory and recovery ordering, no cohort traffic."""
import base64,hashlib,hmac,http.client,json,os,pathlib,re,shutil,subprocess as sp,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[1];RAW=ROOT/'loadtest/results/raw';os.chdir(ROOT)
env={**os.environ,**json.loads((RAW/'environment.json').read_text()),'APP_MONITORING_TIMEOUT_SCAN_INTERVAL':'PT1H'}
java=env['JAVA_HOME']+'/bin/java';jcmd=env['JAVA_HOME']+'/bin/jcmd'
server=None;owns=False;output={}
def sql(query):return sp.check_output(['docker','exec','sm-loadtest-pg','psql','-U','study_monitor','-d','study_monitor','-Atc',query],text=True)
def request(path,body=None):
    c=http.client.HTTPConnection('localhost',18080,timeout=10)
    try:
        c.request('GET' if body is None else 'POST',path,None if body is None else json.dumps(body),({'Content-Type':'application/json'} if path=='/actuator/health' else {'Authorization':'Bearer '+jwt,'Content-Type':'application/json'}))
        r=c.getresponse();b=r.read();assert r.status==200,(r.status,b);return json.loads(b)
    finally:c.close()
def hist():return sp.check_output([jcmd,str(server.pid),'GC.class_histogram'],text=True)
def count(h):
    rows=[l for l in h.splitlines() if re.search(r'\sorg.springframework.web.servlet.mvc.method.annotation.SseEmitter(?:\s|$)',l)]
    return int(rows[0].split()[1]) if rows else 0
def heap():
    sp.check_output([jcmd,str(server.pid),'GC.run']);return sp.check_output([jcmd,str(server.pid),'GC.heap_info'],text=True)
try:
    sp.run(['docker','run','-d','--name','sm-loadtest-pg','-p','127.0.0.1:5434:5432','-e','POSTGRES_DB=study_monitor','-e','POSTGRES_USER=study_monitor','-e','POSTGRES_PASSWORD','postgres:17-alpine'],env={**env,'POSTGRES_PASSWORD':env['DB_PASSWORD']},stdout=sp.DEVNULL,check=True);owns=True
    for _ in range(60):
        if sp.run(['docker','exec','sm-loadtest-pg','pg_isready','-U','study_monitor'],stdout=sp.DEVNULL,stderr=sp.DEVNULL).returncode==0:break
        time.sleep(1)
    artifact=RAW/'memory-server.jar';shutil.copyfile(ROOT/'build/libs/study-monitor-backend-0.0.1-SNAPSHOT.jar',artifact)
    server=sp.Popen([java,'-Xms256m','-Xmx768m','-jar',str(artifact)],env=env,stdout=open(RAW/'memory-server.log','w'),stderr=sp.STDOUT)
    jwt='unused'
    for _ in range(60):
        assert server.poll() is None,'Memory server failed'
        try:request('/actuator/health');break
        except Exception:time.sleep(1)
    user='99990000-0000-0000-0000-000000000001';session='99990000-0000-0000-0000-000000000002'
    sql(f"""BEGIN;
    INSERT INTO users VALUES ('{user}','gap@test.local','unused','Gap probe','STUDENT',now());
    INSERT INTO study_sessions(id,student_id,status,study_date,started_at,current_state,current_state_since,last_seq,last_heartbeat_at,verified_until,created_at)
    VALUES ('{session}','{user}','ACTIVE',(now() at time zone 'Asia/Seoul')::date,now()-interval '120 seconds','UNKNOWN',now()-interval '90 seconds',0,now()-interval '90 seconds',now()-interval '90 seconds',now());
    INSERT INTO activity_intervals(id,session_id,student_id,state,reason,started_at,ended_at,created_at) VALUES
    (gen_random_uuid(),'{session}','{user}','FOCUS_ESTIMATED','SEATED_CONFIRMED',now()-interval '120 seconds',now()-interval '90 seconds',now()),
    (gen_random_uuid(),'{session}','{user}','UNKNOWN','HEARTBEAT_TIMEOUT',now()-interval '90 seconds',NULL,now());COMMIT;""")
    enc=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=').decode()
    data=enc(b'{"alg":"HS256"}')+'.'+enc(json.dumps(dict(iss='study-monitor',sub=user,role='STUDENT',iat=int(time.time()),exp=int(time.time())+3600)).encode())
    jwt=data+'.'+enc(hmac.new(env['JWT_SECRET'].encode(),data.encode(),hashlib.sha256).digest())
    path='/api/v1/study-sessions/'+session;s=request(path);report='/api/v1/me/study-days/'+s['studyDate'];before=request(report)['totals']['focusSeconds']
    request(path+'/heartbeat',dict(sentAt=s['startedAt'],clientState='FOCUS_ESTIMATED',cameraActive=True,pageVisible=True,lastSeq=0))
    transition=request(path+'/transitions',dict(eventId=str(uuid.uuid4()),seq=1,state='FOCUS_ESTIMATED',reason='RECONNECTED',detectedAt=s['startedAt']))
    after=request(report)['totals']['focusSeconds']
    output['heartbeatThenQueuedEvent']={'beforeFocusSeconds':before,'afterFocusSeconds':after,'extraFocusSeconds':after-before,'effectiveAt':transition['effectiveAt'],'oldVerifiedUntil':s['verifiedUntil']}
    (RAW/'memory-probe.json').write_text(json.dumps(output,indent=2));print('Fresh isolated recovery fixture extra focus seconds:',after-before,flush=True)
    output['baselineEmitterCount']=count(hist());assert output['baselineEmitterCount']==0
    output['heapBeforeSse']=heap();sockets=[]
    for _ in range(1000):
        c=http.client.HTTPConnection('localhost',18080,timeout=10);c.request('GET','/api/v1/me/stream',headers={'Authorization':'Bearer '+jwt});r=c.getresponse();assert r.status==200;r.readline();r.readline();sockets.append((c,r))
    output['heapWith1000Sse']=heap();output['emitterCountWith1000']=count(hist());print('Idle sockets connected:',output['emitterCountWith1000'],flush=True)
    for c,r in sockets:r.close();c.close()
    del sockets,c,r
    samples=[]
    for _ in range(10):
        time.sleep(10);n=count(hist());samples.append(n);print('Remaining closed-socket emitters:',n,flush=True)
        if n==0:break
    output['postDisconnectEmitterCounts']=samples;output['heapAfterDisconnect']=heap()
    assert samples[-1]==0,'Emitters retained after 100 seconds'
    output['result']='PASS';print('Fresh idle SSE memory/normal-close cleanup PASS',flush=True)
finally:
    (RAW/'memory-probe.json').write_text(json.dumps(output,indent=2))
    if server and server.poll() is None:server.terminate();server.wait(timeout=45)
    if owns:sp.run(['docker','rm','-f','sm-loadtest-pg'],stdout=sp.DEVNULL)
