#!/usr/bin/env python3
"""Owns only the isolated Docker container and subprocesses it starts. No extra dependencies."""
import json, os, pathlib, secrets, subprocess as sp, sys, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)
RAW=ROOT/'loadtest/results/raw'; RAW.mkdir(parents=True,exist_ok=True)
env=os.environ.copy(); env.update(JAVA_HOME=sp.check_output(['/usr/libexec/java_home','-v','21'],text=True).strip(), DB_URL='jdbc:postgresql://localhost:5434/study_monitor',DB_USERNAME='study_monitor',DB_PASSWORD=secrets.token_urlsafe(24),JWT_SECRET=secrets.token_urlsafe(48),SERVER_PORT='18080')
java=env['JAVA_HOME']+'/bin/java'
envfile=RAW/'environment.json'; envfile.write_text(json.dumps({k:env[k] for k in ('DB_URL','DB_USERNAME','DB_PASSWORD','JWT_SECRET','SERVER_PORT','JAVA_HOME')})); envfile.chmod(0o600)
backend=None

def sql(query):
    return sp.check_output(['docker','exec','sm-loadtest-pg','psql','-U','study_monitor','-d','study_monitor','-Atc',query],text=True)

def start(label):
    log=open(RAW/(label+'-server.log'),'w')
    p=sp.Popen([java,'-Xms256m','-Xmx768m','-jar','build/libs/study-monitor-backend-0.0.1-SNAPSHOT.jar'],env=env,stdout=log,stderr=sp.STDOUT)
    for _ in range(120):
        if p.poll() is not None: raise RuntimeError('Backend failed; inspect local log')
        try:
            import urllib.request
            if urllib.request.urlopen('http://localhost:18080/actuator/health',timeout=1).status==200: return p
        except Exception: pass
        time.sleep(1)
    raise RuntimeError('Backend did not become ready')

try:
    sp.run(['docker','run','-d','--name','sm-loadtest-pg','-p','127.0.0.1:5434:5432','-e','POSTGRES_DB=study_monitor','-e','POSTGRES_USER=study_monitor','-e','POSTGRES_PASSWORD','postgres:17-alpine','-c','shared_preload_libraries=pg_stat_statements','-c','pg_stat_statements.track=all'],env={**env,'POSTGRES_PASSWORD':env['DB_PASSWORD']},check=True,stdout=sp.DEVNULL)
    for _ in range(60):
        if sp.run(['docker','exec','sm-loadtest-pg','pg_isready','-U','study_monitor'],stdout=sp.DEVNULL,stderr=sp.DEVNULL).returncode==0: break
        time.sleep(1)
    sql('create extension if not exists pg_stat_statements')
    cp=sp.check_output(['./gradlew','-q','loadtestClasspath'],env=env,text=True).strip().splitlines()[-1]
    for label in ['before','after']:
        if label=='after':
            (RAW/'baseline-complete').touch()
            print('BASELINE COMPLETE; awaiting continue marker',flush=True)
            while not (RAW/'continue').exists(): time.sleep(2)
        backend=start(label)
        (RAW/'backend.pid').write_text(str(backend.pid))
        (RAW/(label+'-idle.txt')).write_text(sp.check_output(['ps','-p',str(backend.pid),'-o','pid,%cpu,rss,time'],text=True)+sp.check_output([env['JAVA_HOME']+'/bin/jcmd',str(backend.pid),'GC.heap_info'],text=True))
        for users in [10,100,1000]:
            sql('select pg_stat_statements_reset()')
            logfile=open(RAW/f'{label}-{users}.log','w')
            driver=sp.Popen([java,'-Xmx768m','-cp',cp,'com.studymonitor.loadtest.LoadTest',str(users),'180',label],env=env,stdout=logfile,stderr=sp.STDOUT)
            samples=[]
            while driver.poll() is None:
                sample={'at':time.time(),'ps':sp.check_output(['ps','-p',str(backend.pid),'-o','pid,%cpu,rss,time'],text=True),'heap':sp.check_output([env['JAVA_HOME']+'/bin/jcmd',str(backend.pid),'GC.heap_info'],text=True),'connections':sql("select state,count(*) from pg_stat_activity where datname='study_monitor' group by state")}
                samples.append(sample); (RAW/f'{label}-{users}-resources.json').write_text(json.dumps(samples,indent=2)); time.sleep(10)
            if driver.returncode: raise RuntimeError(f'{label} {users} driver failed')
            (RAW/f'{label}-{users}-queries.csv').write_text(sql("copy (select calls,round(mean_exec_time::numeric,3) mean_ms,round(max_exec_time::numeric,3) max_ms,rows,query from pg_stat_statements where query not like '%pg_stat%' order by total_exec_time desc limit 40) to stdout with csv header"))
            print(f'COMPLETE {label} {users}',flush=True)
        backend.terminate(); backend.wait(timeout=45); backend=None
    print('ALL SCENARIOS COMPLETE',flush=True)
finally:
    if backend and backend.poll() is None: backend.terminate(); backend.wait(timeout=45)
    sp.run(['docker','rm','-f','sm-loadtest-pg'],stdout=sp.DEVNULL)
