package com.studymonitor.loadtest;

import java.net.*;
import java.net.http.*;
import java.io.*;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import tools.jackson.databind.*;

/** Real sockets, virtual-thread users, pre-issued HS256 JWTs. No production endpoints added. */
public class LoadTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final ExecutorService EXEC = Executors.newVirtualThreadPerTaskExecutor();
    static final HttpClient HTTP = HttpClient.newBuilder().executor(EXEC).version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(15)).build();
    static final String BASE = System.getenv().getOrDefault("LOADTEST_URL", "http://localhost:18080");
    static final ConcurrentMap<String, Queue<Double>> TIMES = new ConcurrentHashMap<>();
    static final ConcurrentMap<String, AtomicInteger> ERRORS = new ConcurrentHashMap<>();
    static final Queue<Double> DELAYS = new ConcurrentLinkedQueue<>();
    static final AtomicInteger connected = new AtomicInteger(), drops = new AtomicInteger(), reconnects = new AtomicInteger(), events = new AtomicInteger();
    static volatile boolean measuring, running = true;
    static final List<InputStream> STREAMS = new CopyOnWriteArrayList<>();
    static UUID id(int n) { return new UUID(0x5555000000000000L, n); }
    static String token(int n) throws Exception {
        var enc=Base64.getUrlEncoder().withoutPadding();
        String header=enc.encodeToString("{\"alg\":\"HS256\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String claims=JSON.writeValueAsString(Map.of("iss","study-monitor","sub",id(n).toString(),"role",n<0?"TEACHER":"STUDENT","iat",Instant.now().getEpochSecond(),"exp",Instant.now().plusSeconds(7200).getEpochSecond()));
        String input=header+"."+enc.encodeToString(claims.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Mac mac=Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(System.getenv("JWT_SECRET").getBytes(java.nio.charset.StandardCharsets.UTF_8),"HmacSHA256"));
        return input+"."+enc.encodeToString(mac.doFinal(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    static JsonNode request(String name,String path,String token,Object body) throws Exception {
        var b=HttpRequest.newBuilder(URI.create(BASE+path)).timeout(Duration.ofSeconds(60)).header("Authorization","Bearer "+token);
        if(body!=null) b.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
        boolean sample=measuring; long start=System.nanoTime();
        try {
            var r=HTTP.send(b.build(),HttpResponse.BodyHandlers.ofString());
            if(r.statusCode()/100!=2) throw new IOException("HTTP "+r.statusCode()+" "+r.body());
            return JSON.readTree(r.body());
        } catch(Exception e) { if(sample) ERRORS.computeIfAbsent(name,k->new AtomicInteger()).incrementAndGet(); throw e; }
        finally { if(sample) TIMES.computeIfAbsent(name,k->new ConcurrentLinkedQueue<>()).add((System.nanoTime()-start)/1e6); }
    }
    static Map<String,Object> transition(long seq,boolean focus) {
        return Map.of("eventId",UUID.randomUUID().toString(),"seq",seq,"state",focus?"FOCUS_ESTIMATED":"AWAY","reason",focus?"SEATED_CONFIRMED":"PRESENCE_LOST","detectedAt",Instant.now().toString());
    }
    static void stream(String token,boolean teacher) {
        EXEC.submit(()->{
            int attempt=0;
            while(running) {
                try {
                    var req=HttpRequest.newBuilder(URI.create(BASE+(teacher?"/api/v1/teacher/stream":"/api/v1/me/stream"))).header("Authorization","Bearer "+token).build();
                    var response=HTTP.send(req,HttpResponse.BodyHandlers.ofInputStream());
                    if(response.statusCode()!=200) { response.body().close(); throw new IOException("SSE "+response.statusCode()); }
                    InputStream input=response.body(); STREAMS.add(input); connected.incrementAndGet(); if(attempt++>0) reconnects.incrementAndGet();
                    try(var reader=new BufferedReader(new InputStreamReader(input))) {
                        for(String line;(line=reader.readLine())!=null && running;) {
                            if(line.startsWith("data:") && measuring) {
                                JsonNode event=JSON.readTree(line.substring(5).trim()); events.incrementAndGet();
                                DELAYS.add((double)Duration.between(Instant.parse(event.get("at").asText()),Instant.now()).toMillis());
                            }
                        }
                    } finally { STREAMS.remove(input); connected.decrementAndGet(); }
                    if(running && measuring) drops.incrementAndGet();
                } catch(Exception e) { if(running && measuring) drops.incrementAndGet(); }
                if(running) Thread.sleep(1000);
            }
            return null;
        });
    }
    static Map<String,Object> percentiles(Collection<Double> values) {
        var sorted=values.stream().sorted().toList();
        if(sorted.isEmpty()) return Map.of("count",0);
        var out=new LinkedHashMap<String,Object>(); out.put("count",sorted.size());
        for(var p:Map.of("p50",.5,"p95",.95,"p99",.99).entrySet()) out.put(p.getKey(),sorted.get(Math.min(sorted.size()-1,(int)Math.ceil(sorted.size()*p.getValue())-1)));
        return out;
    }
    public static void main(String[] args) throws Exception {
        if(!BASE.equals("http://localhost:18080")) throw new IllegalArgumentException("Driver restricted to isolated localhost:18080");
        int users=Integer.parseInt(args[0]), seconds=Integer.parseInt(args[1]); String label=args[2];
        String db=System.getenv("DB_URL"); if(!db.contains("localhost:5434/")) throw new IllegalArgumentException("Seed restricted to localhost:5434");
        int teachers=Math.max(1,(users+99)/100);
        try(var c=DriverManager.getConnection(db,System.getenv("DB_USERNAME"),System.getenv("DB_PASSWORD"))) {
            try(var s=c.createStatement()) { s.execute("TRUNCATE users CASCADE"); }
            try(var s=c.prepareStatement("insert into users values (?, ?, ?, ?, ?, now())")) {
                for(int n=-teachers;n<=users;n++) if(n!=0) {
                    s.setObject(1,id(n)); s.setString(2,"load"+n+"@test.local"); s.setString(3,"unused-preissued-jwt"); s.setString(4,"Load "+n); s.setString(5,n<0?"TEACHER":"STUDENT"); s.addBatch();
                } s.executeBatch();
            }
            try(var s=c.prepareStatement("insert into teacher_students values (?, ?, now())")) {
                for(int n=1;n<=users;n++) { s.setObject(1,id(-1-(n-1)/100)); s.setObject(2,id(n)); s.addBatch(); } s.executeBatch();
            }
        }
        var usersReady=new CountDownLatch(users); var go=new CountDownLatch(1); var futures=new ArrayList<Future<?>>();
        for(int t=1;t<=teachers;t++) { String jwt=token(-t); stream(jwt,true); }
        for(int n=1;n<=users;n++) {
            final int student=n; String jwt=token(n);
            futures.add(EXEC.submit(()->{
                String session=request("start","/api/v1/study-sessions",jwt,Map.of("clientStartedAt",Instant.now().toString())).get("id").asText();
                String path="/api/v1/study-sessions/"+session; long seq=1; boolean focus=true;
                request("transition",path+"/transitions",jwt,transition(seq,focus)); stream(jwt,false); usersReady.countDown(); go.await();
                // Stagger cadence to model independently arriving clients, not a synchronized burst.
                Thread.sleep((student*7919L)%30000);
                while(running) {
                    long tick=System.nanoTime();
                    try {
                        request("heartbeat",path+"/heartbeat",jwt,Map.of("sentAt",Instant.now().toString(),"clientState",focus?"FOCUS_ESTIMATED":"AWAY","cameraActive",true,"pageVisible",true,"lastSeq",seq));
                        if(student%5==0) { focus=!focus; request("transition",path+"/transitions",jwt,transition(++seq,focus)); }
                        if(student%10==0) request("report","/api/v1/me/study-days/"+LocalDate.now(ZoneId.of("Asia/Seoul")),jwt,null);
                        if(student%100==1) request("overview","/api/v1/teacher/students",token(-1-(student-1)/100),null);
                    } catch(Exception e) { System.err.println(e.getMessage()); }
                    long sleep=30000-(System.nanoTime()-tick)/1000000; if(sleep>0) Thread.sleep(sleep);
                }
                return null;
            }));
        }
        if(!usersReady.await(120,TimeUnit.SECONDS)) throw new IllegalStateException("Users did not start: "+usersReady.getCount());
        go.countDown(); System.out.println("WARMUP users="+users+" SSE="+connected.get()); Thread.sleep(30000);
        measuring=true; System.out.println("STEADY "+Instant.now()+" users="+users+" SSE="+connected.get());
        long start=System.nanoTime(); Thread.sleep(seconds*1000L); measuring=false; double elapsed=(System.nanoTime()-start)/1e9;
        var endpoints=new TreeMap<String,Object>(); TIMES.forEach((name,times)->{ var stats=new LinkedHashMap<>(percentiles(times)); stats.put("errors",ERRORS.getOrDefault(name,new AtomicInteger()).get()); endpoints.put(name,stats); });
        var out=new LinkedHashMap<String,Object>(); out.put("users",users); out.put("steadySeconds",elapsed); out.put("endpoints",endpoints); out.put("requestsPerSecond",TIMES.values().stream().mapToInt(Collection::size).sum()/elapsed);
        out.put("sse",Map.of("connected",connected.get(),"expected",users+teachers,"drops",drops.get(),"reconnects",reconnects.get(),"events",events.get(),"deliveryDelayMs",percentiles(DELAYS)));
        Files.writeString(Path.of("loadtest/results/raw/"+label+"-"+users+".json"),JSON.writerWithDefaultPrettyPrinter().writeValueAsString(out));
        System.out.println(JSON.writeValueAsString(out)); running=false;
        for(var input:STREAMS) try { input.close(); } catch(IOException ignored) {}
        HTTP.close(); EXEC.shutdownNow(); System.exit(0);
    }
}
