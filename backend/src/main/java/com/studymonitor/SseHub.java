package com.studymonitor;

import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.event.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;

@Component
public class SseHub {
    public record Published(UUID id, Api.StreamEvent data, Set<UUID> recipients) {}
    private final ConcurrentMap<UUID,Set<SseEmitter>> registry=new ConcurrentHashMap<>();

    public SseEmitter subscribe(UUID user) { return register(user,new SseEmitter(0L)); }
    // Exposed to allow a real emitter test double to verify framing and delivery after commit.
    SseEmitter register(UUID user,SseEmitter emitter) {
        registry.compute(user,(key,set) -> {
            if(set==null) set=ConcurrentHashMap.newKeySet();
            set.add(emitter); return set;
        });
        Runnable remove=() -> remove(user,emitter);
        emitter.onCompletion(remove); emitter.onTimeout(remove); emitter.onError(error -> remove.run());
        send(user,emitter,SseEmitter.event().comment(" ping"));
        return emitter;
    }
    private void remove(UUID user,SseEmitter emitter) {
        registry.computeIfPresent(user,(key,set) -> { set.remove(emitter); return set.isEmpty()?null:set; });
    }
    private void send(UUID user,SseEmitter emitter,SseEmitter.SseEventBuilder data) {
        try { synchronized(emitter) { emitter.send(data); } }
        catch(Exception e) {
            remove(user,emitter);
            try { emitter.completeWithError(e); }
            catch(IllegalStateException alreadyClosed) {
                // Tomcat may have already delivered onError and invalidated the async context.
                // One dead socket must not abort delivery to the remaining subscribers.
            }
        }
    }
    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    public void publish(Published event) {
        for(UUID user:event.recipients()) {
            for(SseEmitter emitter:registry.getOrDefault(user,Set.of())) {
                send(user,emitter,SseEmitter.event().name("monitoring").id(event.id().toString()).data(event.data()));
            }
        }
    }
    @Scheduled(fixedDelayString="${app.monitoring.sse-ping-interval:PT25S}")
    public void ping() { registry.forEach((user,set) -> set.forEach(emitter -> send(user,emitter,SseEmitter.event().comment(" ping")))); }
    @PreDestroy public void close() { registry.values().forEach(set -> set.forEach(SseEmitter::complete)); registry.clear(); }
    int subscriberCount() { return registry.values().stream().mapToInt(Set::size).sum(); }
}
