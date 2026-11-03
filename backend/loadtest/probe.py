#!/usr/bin/env python3
"""Run during the runner's baseline pause, when 18080 is free; credentials stay local."""
import base64, hashlib, hmac, http.client, json, os, pathlib, shutil, socket, subprocess as sp, sys, time, uuid
from datetime import datetime,timezone
ROOT=pathlib.Path(__file__).resolve().parents[1]; os.chdir(ROOT)
RAW=ROOT/'loadtest/results/raw'; env={**os.environ,**json.loads((RAW/'environment.json').read_text())}
label=sys.argv[1]; source=pathlib.Path(sys.argv[2]); java=env['JAVA_HOME']+'/bin/java'
USER=str(uuid.UUID(int=(0x5555000000000000<<64)+1))
TEACHER=str(uuid.UUID(int=(0x5555000000000000<<64)+(2**64-1)))

def stamp(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def token(subject,role):
    encode=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=').decode()
    data=encode(b'{"alg":"HS256"}')+'.'+encode(json.dumps(dict(iss='study-monitor',sub=subject,role=role,iat=int(time.time()),exp=int(time.time())+7200)).encode())
    return data+'.'+encode(hmac.new(env['JWT_SECRET'].encode(),data.encode(),hashlib.sha256).digest())
JWT=token(USER,'STUDENT'); TJ=token(TEACHER,'TEACHER')
def request(path,body=None,jwt=JWT):
    c=http.client.HTTPConnection('localhost',18080,timeout=15)
    try:
        c.request('GET' if body is None else 'POST',path,None if body is None else json.dumps(body),{'Authorization':'Bearer '+jwt,'Content-Type':'application/json'})
        r=c.getresponse(); data=r.read(); assert r.status in (200,201),(r.status,data)
        return json.loads(data)
    finally: c.close()
def sql(query): return sp.check_output(['docker','exec','sm-loadtest-pg','psql','-U','study_monitor','-d','study_monitor','-Atc',query],text=True)
def heap():
    sp.check_output([env['JAVA_HOME']+'/bin/jcmd',str(server.pid),'GC.run'])
    return sp.check_output([env['JAVA_HOME']+'/bin/jcmd',str(server.pid),'GC.heap_info'],text=True)
def histogram(): return sp.check_output([env['JAVA_HOME']+'/bin/jcmd',str(server.pid),'GC.class_histogram'],text=True)
def start():
    with socket.socket() as s:
        assert s.connect_ex(('localhost',18080))!=0,'18080 already in use'
    p=sp.Popen([java,'-Xms256m','-Xmx768m','-jar',str(artifact)],env=env,stdout=open(RAW/(label+'-probe-server.log'),'a'),stderr=sp.STDOUT)
    for _ in range(60):
        assert p.poll() is None,'probe backend failed'
        try:
            request('/actuator/health');return p
        except Exception: time.sleep(1)
    raise RuntimeError('probe not ready')
def transition(session,seq,state,reason):
    return request('/api/v1/study-sessions/'+session+'/transitions',dict(eventId=str(uuid.uuid4()),seq=seq,state=state,reason=reason,detectedAt=stamp()))
def stream():
    c=http.client.HTTPConnection('localhost',18080,timeout=10)
    c.request('GET','/api/v1/me/stream',headers={'Authorization':'Bearer '+JWT})
    r=c.getresponse(); assert r.status==200
    assert r.readline().startswith(b':')
    r.readline()
    return c,r
artifact=RAW/(label+'-probe.jar');shutil.copyfile(source,artifact)
server=None; output={}
try:
    server=start()
    latencies=[]
    for _ in range(30):
        t=time.monotonic(); session=request('/api/v1/study-sessions',dict(clientStartedAt=stamp()))['id'];latencies.append((time.monotonic()-t)*1000)
    output['startLatencyMs']=sorted(latencies)
    transition(session,1,'FOCUS_ESTIMATED','SEATED_CONFIRMED')
    path='/api/v1/study-sessions/'+session
    sql('select pg_stat_statements_reset()')
    heartbeat_times=[]
    for _ in range(100):
        t=time.monotonic(); request(path+'/heartbeat',dict(sentAt=stamp(),clientState='FOCUS_ESTIMATED',cameraActive=True,pageVisible=True,lastSeq=1));heartbeat_times.append((time.monotonic()-t)*1000)
    output['heartbeatLatencyMs']=sorted(heartbeat_times)
    output['heartbeatQueries']=sql("copy (select calls,round(mean_exec_time::numeric,3),query from pg_stat_statements where query not like '%pg_stat%' order by calls desc) to stdout with csv header")
    sql('select pg_stat_statements_reset()')
    overview_times=[]
    for _ in range(10):
        t=time.monotonic();request('/api/v1/teacher/students',jwt=TJ);overview_times.append((time.monotonic()-t)*1000)
    output['overviewLatencyMs']=sorted(overview_times)
    output['overviewQueries']=sql("copy (select calls,round(mean_exec_time::numeric,3),query from pg_stat_statements where query not like '%pg_stat%' order by calls desc) to stdout with csv header")
    if label=='after':
        # Retained heap delta for idle sockets: same user, no events or report traffic.
        output['heapBeforeSse']=heap(); sockets=[]
        for _ in range(1000): sockets.append(stream())
        output['heapWith1000Sse']=heap()
        output['histogramWith1000Sse']=histogram()
        for c,r in sockets: r.close(); c.close()
        del sockets,c,r
        time.sleep(27)
        output['heapAfterDisconnect']=heap(); output['histogramAfterDisconnect']=histogram()
        c,r=stream(); r.close();c.close()
        transition(session,2,'AWAY','PRESENCE_LOST') # event missed during simulated network loss
        c,r=stream()
        assert request(path)['currentState']=='AWAY' # contract reconnect refetch
        transition(session,3,'FOCUS_ESTIMATED','RECONNECTED')
        received=[]
        while True:
            line=r.readline().decode(); received.append(line)
            if line.startswith('data:'): break
        assert 'FOCUS_ESTIMATED' in ''.join(received)
        r.close();c.close();output['networkLossReconnect']='PASS: refetch recovers missed AWAY; reconnected stream receives fresh FOCUS_ESTIMATED'
        time.sleep(2)
        request(path+'/heartbeat',dict(sentAt=stamp(),clientState='FOCUS_ESTIMATED',cameraActive=True,pageVisible=True,lastSeq=3))
        verified=request(path)['verifiedUntil']; server.kill();server.wait();server=None
        time.sleep(92)
        server=start()
        for _ in range(20):
            recovered=request(path)
            if recovered['currentState']=='UNKNOWN': break
            time.sleep(1)
        assert recovered['currentState']=='UNKNOWN',recovered
        assert recovered['currentStateSince']==verified,(recovered,verified)
        closed=sql("select ended_at=verified_until from activity_intervals a join study_sessions s on s.id=a.session_id where a.session_id='"+session+"' and a.state='FOCUS_ESTIMATED' order by a.started_at desc limit 1").strip()
        assert closed=='t',closed
        output['abruptRestart']='PASS: SIGKILL, 92 seconds offline, persisted ACTIVE session becomes UNKNOWN at exact verifiedUntil; focus interval closed there'
    (RAW/(label+'-probe.json')).write_text(json.dumps(output,indent=2))
    print(label+' probes PASS',flush=True)
finally:
    if server and server.poll() is None:server.terminate();server.wait(timeout=45)
