package com.studymonitor;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static com.studymonitor.Api.*;
import static com.studymonitor.Domain.*;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class SessionService {
    private final Store store; private final AuthService auth; private final Clock clock;
    private final AppConfig.Monitoring config; private final ObjectMapper json;
    private final ApplicationEventPublisher publisher;
    public SessionService(Store store,AuthService auth,Clock clock,AppConfig.Monitoring config,
                          ObjectMapper json,ApplicationEventPublisher publisher) {
        this.store=store; this.auth=auth; this.clock=clock; this.config=config; this.json=json; this.publisher=publisher;
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    static Instant max(Instant a,Instant b) { return a.isAfter(b)?a:b; }
    static Instant min(Instant a,Instant b) { return a.isBefore(b)?a:b; }
    static Instant clamp(Instant time,Instant start,Instant end) { return min(end,max(time,start)); }
    public Session view(StudySession s) {
        return new Session(s.id,s.studentId,s.status,s.studyDate,s.startedAt,s.endedAt,s.endReason,
                           s.currentState,s.currentStateSince,s.lastSeq,s.lastHeartbeatAt,s.verifiedUntil,
                           config.heartbeatInterval().toSeconds(),config.heartbeatTimeout().toSeconds());
    }
    @Transactional
    public Session start(UUID student,StartRequest request) {
        auth.student(student);
        // Also serialize starts when there is no session row yet.
        store.lockAccount(student);
        var existing=store.activeForUpdate(student);
        // A mutation ahead of us can advance verifiedUntil while we wait for the session lock.
        Instant now=now();
        existing.ifPresent(session -> finish(session,session.verifiedUntil,Reason.SESSION_REPLACED,now));
        store.flush();
        StudySession s=new StudySession(); s.id=UUID.randomUUID(); s.studentId=student; s.status=Status.ACTIVE;
        s.startedAt=now; s.studyDate=now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate();
        s.currentState=State.UNKNOWN; s.currentStateSince=now; s.verifiedUntil=now; s.createdAt=now;
        s.clientInfo=request.clientInfo()==null?null:json.writeValueAsString(request.clientInfo());
        store.add(s);
        MonitoringEvent event=event(s,State.UNKNOWN,Reason.SESSION_STARTED,now,now);
        open(s,event,now,now); announce(s,event,EventType.SESSION_STARTED);
        return view(s);
    }
    @Transactional(readOnly=true)
    public Session get(UUID viewer,UUID sessionId) {
        StudySession s=required(sessionId,false); auth.canRead(viewer,s.studentId); return view(s);
    }
    private StudySession required(UUID id,boolean lock) {
        StudySession s=store.session(id,lock);
        if(s==null) throw fail(NOT_FOUND,"NOT_FOUND","Study session not found");
        return s;
    }
    private StudySession own(UUID student,UUID sessionId) {
        auth.student(student);
        StudySession s=required(sessionId,true);
        if(!s.studentId.equals(student)) throw fail(FORBIDDEN,"FORBIDDEN","Session belongs to another student");
        return s;
    }
    private void active(StudySession s) {
        if(s.status!=Status.ACTIVE) throw fail(CONFLICT,"SESSION_ENDED","Study session has ended");
    }
    @Transactional
    public TransitionResponse transition(UUID student,UUID sessionId,TransitionRequest request) {
        StudySession s=own(student,sessionId);
        store.lockEventKey(request.eventId());
        var previous=store.event(request.eventId());
        Instant detected=request.detectedAt().truncatedTo(ChronoUnit.MICROS);
        if(previous.isPresent()) {
            MonitoringEvent e=previous.get();
            if(!e.sessionId.equals(s.id) || !Objects.equals(e.seq,request.seq()) || e.state!=request.state()
               || e.reason!=request.reason() || !e.detectedAt.equals(detected))
                throw fail(CONFLICT,"EVENT_ID_CONFLICT","eventId was already used with a different payload");
            return json.readValue(e.response,TransitionResponse.class).replay();
        }
        active(s);
        if(request.seq()<=s.lastSeq) throw fail(CONFLICT,"SEQ_OUT_OF_ORDER","seq must be greater than lastSeq");
        Instant now=now();
        if(request.detectedAt().isAfter(now.plus(config.maxFutureSkew()))) throw fail(BAD_REQUEST,"CLOCK_SKEW","detectedAt is too far in the future");
        if(EnumSet.of(Reason.SESSION_STARTED,Reason.SESSION_ENDED,Reason.SESSION_REPLACED,Reason.HEARTBEAT_TIMEOUT).contains(request.reason()))
            throw fail(BAD_REQUEST,"VALIDATION_FAILED","reason is reserved for the server");
        // Enforce elapsed silence here too: reconnect requests need not wait for the next scan.
        timeoutIfNeeded(s,now);
        ActivityInterval current=store.open(s.id);
        boolean changed=s.currentState!=request.state();
        // Recovery cannot backdate presence into an outage, even if a heartbeat arrived first.
        boolean timeoutRecovery=changed && current.state==State.UNKNOWN && current.reason==Reason.HEARTBEAT_TIMEOUT;
        Instant effective=timeoutRecovery?now:clamp(detected,current.startedAt,now);
        MonitoringEvent e=event(s,request.state(),request.reason(),effective,now);
        e.source="CLIENT"; e.eventId=request.eventId(); e.seq=request.seq(); e.detectedAt=detected;
        e.confidence=request.confidence(); e.signals=request.signals()==null?null:json.writeValueAsString(request.signals());
        if(changed) change(s,current,e,effective,now);
        s.lastSeq=request.seq(); s.verifiedUntil=max(s.verifiedUntil,effective);
        TransitionResponse response=new TransitionResponse(request.eventId(),request.seq(),false,now,effective,
                                                            s.currentState,s.currentStateSince,changed);
        e.response=json.writeValueAsString(response);
        if(changed) announce(s,e,EventType.STATE_CHANGED);
        return response;
    }
    @Transactional
    public HeartbeatResponse heartbeat(UUID student,UUID sessionId,HeartbeatRequest request) {
        StudySession s=own(student,sessionId); active(s); Instant now=now();
        timeoutIfNeeded(s,now);
        s.lastHeartbeatAt=now;
        if(request.cameraActive()) s.verifiedUntil=now;
        else if(measurable(s.currentState)) {
            MonitoringEvent e=event(s,State.UNKNOWN,Reason.CAMERA_STOPPED,now,now);
            change(s,store.open(s.id),e,now,now); s.verifiedUntil=max(s.verifiedUntil,now); announce(s,e,EventType.STATE_CHANGED);
        }
        // The interval reason is only needed for UNKNOWN; normal heartbeats update one row.
        boolean timedOut=s.currentState==State.UNKNOWN && store.open(s.id).reason==Reason.HEARTBEAT_TIMEOUT;
        return new HeartbeatResponse(now,s.currentState,s.currentStateSince,s.lastSeq,
            timedOut,config.heartbeatInterval().toSeconds());
    }
    @Transactional
    public Session end(UUID student,UUID sessionId,EndRequest request) {
        StudySession s=own(student,sessionId);
        if(s.status==Status.ENDED) return view(s);
        Instant now=now();
        finish(s,clamp(request.endedAt().truncatedTo(ChronoUnit.MICROS),store.open(s.id).startedAt,now),Reason.SESSION_ENDED,now);
        return view(s);
    }
    private void finish(StudySession s,Instant at,Reason reason,Instant now) {
        close(store.open(s.id),at);
        s.status=Status.ENDED; s.endedAt=at; s.endReason=reason;
        MonitoringEvent e=event(s,s.currentState,reason,at,now);
        announce(s,e,EventType.SESSION_ENDED);
    }
    private boolean measurable(State state) { return state!=State.UNKNOWN && state!=State.BREAK; }
    @Transactional(readOnly=true)
    public List<UUID> timeoutCandidates() { return store.expired(now().minus(config.heartbeatTimeout())); }
    @Transactional
    public void timeout(UUID id) {
        StudySession s=store.session(id,true);
        if(s!=null && s.status==Status.ACTIVE) timeoutIfNeeded(s,now());
    }
    private void timeoutIfNeeded(StudySession s,Instant now) {
        Instant last=s.lastHeartbeatAt==null?s.startedAt:s.lastHeartbeatAt;
        if(measurable(s.currentState) && last.isBefore(now.minus(config.heartbeatTimeout()))) {
            MonitoringEvent e=event(s,State.UNKNOWN,Reason.HEARTBEAT_TIMEOUT,s.verifiedUntil,now);
            change(s,store.open(s.id),e,s.verifiedUntil,now); announce(s,e,EventType.STATE_CHANGED);
        }
    }
    private MonitoringEvent event(StudySession s,State state,Reason reason,Instant at,Instant now) {
        MonitoringEvent e=new MonitoringEvent(); e.id=UUID.randomUUID(); e.sessionId=s.id; e.studentId=s.studentId;
        e.source="SERVER"; e.state=state; e.reason=reason; e.effectiveAt=at; e.serverReceivedAt=now;
        store.add(e); return e;
    }
    private void close(ActivityInterval interval,Instant at) {
        if(!at.isAfter(interval.startedAt)) store.remove(interval);
        else interval.endedAt=at;
        // Hibernate inserts before deletes: flush the old range before creating an adjacent range.
        store.flush();
    }
    private void open(StudySession s,MonitoringEvent event,Instant at,Instant now) {
        ActivityInterval i=new ActivityInterval(); i.id=UUID.randomUUID(); i.sessionId=s.id; i.studentId=s.studentId;
        i.state=event.state; i.reason=event.reason; i.startedAt=at; i.createdAt=now; i.openedByEventId=event.id;
        store.add(i);
    }
    private void change(StudySession s,ActivityInterval current,MonitoringEvent event,Instant at,Instant now) {
        close(current,at); open(s,event,at,now); s.currentState=event.state; s.currentStateSince=at;
    }
    private void announce(StudySession s,MonitoringEvent e,EventType type) {
        Set<UUID> recipients=new HashSet<>(store.teachers(s.studentId)); recipients.add(s.studentId);
        publisher.publishEvent(new SseHub.Published(e.id,new StreamEvent(type,s.studentId,s.id,e.state,e.reason,e.effectiveAt),Set.copyOf(recipients)));
    }
}
