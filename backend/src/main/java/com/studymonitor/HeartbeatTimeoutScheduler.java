package com.studymonitor;

import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;

@Component
public class HeartbeatTimeoutScheduler {
    private final SessionService sessions;
    public HeartbeatTimeoutScheduler(SessionService sessions) { this.sessions=sessions; }
    @Scheduled(fixedDelayString="${app.monitoring.timeout-scan-interval:PT10S}")
    public void scan() {
        for(var id:sessions.timeoutCandidates()) {
            try { sessions.timeout(id); }
            catch(RuntimeException e) {
                org.slf4j.LoggerFactory.getLogger(getClass()).error("Timeout scan failed for session {} ({})",id,e.getClass().getName());
            }
        }
    }
}
