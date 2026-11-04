package com.studymonitor;

import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import jakarta.servlet.http.HttpServletRequest;
import java.time.*;
import java.util.*;
import static com.studymonitor.Problems.*;

/** Sliding windows and consecutive login failures; deliberately per process. */
@Component
public class AuthThrottle {
    private final Clock clock;
    private final AppConfig.Auth settings;
    private final Map<String,Deque<Instant>> windows=new HashMap<>();
    private final Map<String,Failures> failures=new HashMap<>();
    private record Failures(int count,Instant until) {}
    public AuthThrottle(Clock clock,AppConfig.Auth settings) { this.clock=clock; this.settings=settings; }
    public String clientIp(HttpServletRequest request) {
        String forwarded=request.getHeader("X-Forwarded-For");
        if(settings.trustedProxy() && forwarded!=null && !forwarded.isBlank()) {
            String[] hops=forwarded.split(",",-1);
            String last=hops[hops.length-1].trim();
            if(!last.isEmpty()) return last;
        }
        return request.getRemoteAddr();
    }
    public void credential(HttpServletRequest request) { take("auth:"+clientIp(request),settings.ipLimitPerMinute(),Duration.ofMinutes(1)); }
    public void refresh(HttpServletRequest request) { take("refresh:"+clientIp(request),settings.refreshIpLimitPerMinute(),Duration.ofMinutes(1)); }
    public void join(UUID student) { take("join:"+student,10,Duration.ofMinutes(10)); }
    synchronized void take(String key,int limit,Duration duration) {
        Instant now=clock.instant();
        Deque<Instant> events=windows.computeIfAbsent(key,k -> new ArrayDeque<>());
        while(!events.isEmpty() && !events.peekFirst().plus(duration).isAfter(now)) events.removeFirst();
        if(events.size()>=limit) throw throttled(seconds(now,events.peekFirst().plus(duration)));
        events.addLast(now);
    }
    public synchronized void checkEmail(String email) {
        Failures value=failures.get(email);
        if(value==null || value.until()==null) return;
        if(!clock.instant().isBefore(value.until())) { failures.remove(email); return; }
        if(value.count()>=5) throw throttled(seconds(clock.instant(),value.until()));
    }
    public synchronized void failed(String email) {
        int count=Optional.ofNullable(failures.get(email)).map(Failures::count).orElse(0)+1;
        failures.put(email,new Failures(count,count>=5?clock.instant().plus(Duration.ofMinutes(15)):null));
        // The fifth failure starts the lock and itself returns 429.
        if(count>=5) throw throttled(900);
    }
    public synchronized void succeeded(String email) { checkEmail(email); failures.remove(email); }
    private long seconds(Instant now,Instant until) { return Math.max(1,(Duration.between(now,until).toMillis()+999)/1000); }
    @Scheduled(fixedDelayString="PT10M")
    synchronized void prune() {
        Instant now=clock.instant();
        windows.entrySet().removeIf(e -> e.getValue().isEmpty() || !e.getValue().peekLast().plus(Duration.ofMinutes(10)).isAfter(now));
        failures.entrySet().removeIf(e -> e.getValue().until()!=null && !e.getValue().until().isAfter(now));
    }
    synchronized void clear() { windows.clear(); failures.clear(); }
}
