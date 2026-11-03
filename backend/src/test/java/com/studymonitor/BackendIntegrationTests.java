package com.studymonitor;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.*;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.dao.DataIntegrityViolationException;
import tools.jackson.databind.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static com.studymonitor.Api.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class,BackendIntegrationTests.TimeConfiguration.class})
class BackendIntegrationTests {
    static final UUID STUDENT=UUID.fromString("20000000-0000-0000-0000-000000000001");
    static final UUID STUDENT2=UUID.fromString("20000000-0000-0000-0000-000000000002");
    static final UUID TEACHER=UUID.fromString("10000000-0000-0000-0000-000000000001");
    static final UUID TEACHER2=UUID.fromString("10000000-0000-0000-0000-000000000002");
    static final LocalDate DATE=LocalDate.parse("2026-11-03");
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired MutableClock clock;
    @Autowired SessionService sessions;
    @Autowired Store store;
    @Autowired ReportService reports;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired SseHub streams;
    @Autowired HeartbeatTimeoutScheduler scheduler;
    @Autowired PasswordEncoder passwords;
    @Autowired PlatformTransactionManager transactions;
    String studentToken,teacherToken,teacher2Token;

    @TestConfiguration(proxyBeanMethods=false)
    static class TimeConfiguration {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }
    static class MutableClock extends Clock {
        final AtomicReference<Instant> time=new AtomicReference<>(Instant.parse("2026-11-02T23:50:00Z"));
        void set(String value) { time.set(Instant.parse(value)); }
        void advance(long seconds) { time.updateAndGet(t -> t.plusSeconds(seconds)); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return time.get(); }
    }
    @BeforeEach void reset() {
        streams.close();
        jdbc.execute("TRUNCATE study_sessions, activity_intervals, monitoring_events CASCADE");
        clock.set("2026-11-02T23:50:00Z");
        studentToken=token("student1@demo.local"); teacherToken=token("teacher@demo.local"); teacher2Token=token("teacher2@demo.local");
    }
    String token(String email) { return auth.login(new LoginRequest(email,"demo1234!")).accessToken(); }
    Session start() { return sessions.start(STUDENT,new StartRequest(clock.instant(),null)); }
    TransitionRequest request(long seq,State state,Reason reason,Instant detected) {
        return new TransitionRequest(UUID.randomUUID(),seq,state,reason,detected,0.9f,null);
    }
    TransitionResponse change(Session s,long seq,State state,Reason reason) {
        return sessions.transition(STUDENT,s.id(),request(seq,state,reason,clock.instant()));
    }
    HeartbeatResponse heartbeat(Session s,boolean camera) {
        return sessions.heartbeat(STUDENT,s.id(),new HeartbeatRequest(clock.instant(),State.UNKNOWN,camera,true,0L));
    }
    JsonNode body(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
    ResultActions postJson(String path,String token,Object payload) throws Exception {
        var builder=post(path).contentType("application/json").content(json.writeValueAsString(payload));
        if(!token.equals("unused")) builder.header("Authorization","Bearer "+token);
        return mvc.perform(builder);
    }
    long count(String table) { return jdbc.queryForObject("select count(*) from "+table,Long.class); }
    void failure(Runnable action,String code) {
        assertThatThrownBy(action::run).isInstanceOf(Problems.Failure.class).extracting("code").isEqualTo(code);
    }
    @Test void contextLoadsAndAllDemoPasswordsMatch() {
        assertThat(jdbc.queryForList("select password_hash from users",String.class)).hasSize(5).allMatch(hash -> passwords.matches("demo1234!",hash));
    }
    @Test void loginAndJwtAuthenticateActualRequests() throws Exception {
        var result=postJson("/api/v1/auth/login","unused",new LoginRequest("STUDENT1@demo.local","demo1234!"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.tokenType").value("Bearer"))
            .andExpect(jsonPath("$.user.role").value("STUDENT")).andReturn();
        String token=body(result).get("accessToken").asText();
        mvc.perform(get("/api/v1/me").header("Authorization","Bearer "+token)).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(STUDENT.toString()));
    }
    @Test void badPasswordAndUnknownAccountReturn401() throws Exception {
        for(String email:List.of("student1@demo.local","absent@demo.local")) {
            postJson("/api/v1/auth/login","unused",new LoginRequest(email,"wrong"))
                .andExpect(status().isUnauthorized()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("BAD_CREDENTIALS"));
        }
    }
    @Test void missingOrInvalidTokenReturns401() throws Exception {
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(get("/api/v1/me").header("Authorization","Bearer invalid")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }
    @Test void studentCannotAccessTeacherAndTeacherCannotStart() throws Exception {
        mvc.perform(get("/api/v1/teacher/students").header("Authorization","Bearer "+studentToken)).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        postJson("/api/v1/study-sessions",teacherToken,new StartRequest(clock.instant(),null)).andExpect(status().isForbidden());
    }
    @Test void validationIsProblemJsonAndRejectsUncontractedEvidence() throws Exception {
        postJson("/api/v1/auth/login","unused",Map.of("email","invalid","password",""))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED")).andExpect(jsonPath("$.errors").isArray());
        Session s=start();
        var payload=new HashMap<String,Object>();
        payload.put("eventId",UUID.randomUUID()); payload.put("seq",1); payload.put("state","AWAY"); payload.put("reason","PRESENCE_LOST"); payload.put("detectedAt",clock.instant()); payload.put("signals",Map.of("landmarks",List.of(1,2)));
        postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,payload).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        postJson("/api/v1/study-sessions/"+s.id()+"/heartbeat",studentToken,Map.of("sentAt",clock.instant(),"clientState","UNKNOWN","lastSeq",0))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/me/study-days/not-a-date").header("Authorization","Bearer "+studentToken)).andExpect(status().isBadRequest());
    }
    @Test void corsAllowsAuthorizationAndOpenApiIsPublic() throws Exception {
        mvc.perform(options("/api/v1/study-sessions").header("Origin","http://localhost:3000").header("Access-Control-Request-Method","POST").header("Access-Control-Request-Headers","Authorization,Content-Type"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin","http://localhost:3000"));
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andExpect(jsonPath("$.paths['/api/v1/auth/login']").exists());
    }
    @ParameterizedTest @CsvSource({"2026-11-02T23:55:00Z,0,ON_TIME","2026-11-03T00:13:22Z,802,LATE"})
    void latenessUsesEvidenceOnsetInSeoul(String onset,long expected,String status) {
        Session s=start(); clock.set(onset); Instant detected=clock.instant(); clock.advance(15);
        sessions.transition(STUDENT,s.id(),request(1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,detected));
        Report report=reports.mine(STUDENT,DATE);
        assertThat(report.firstSeatedAt()).isEqualTo(detected);
        assertThat(report.referenceTime()).isEqualTo(Instant.parse("2026-11-03T00:00:00Z"));
        assertThat(report.lateSeconds()).isEqualTo(expected); assertThat(report.lateStatus().name()).isEqualTo(status);
    }
    @Test void noSeatReportsNotSeated() {
        start(); Report r=reports.mine(STUDENT,DATE);
        assertThat(r.lateStatus()).isEqualTo(LateStatus.NOT_SEATED); assertThat(r.lateSeconds()).isNull(); assertThat(r.firstSeatedAt()).isNull();
    }
    @Test void duplicateReplaysStoredResponseAndConflictingPayloadFails() throws Exception {
        Session s=start(); clock.advance(10); var req=request(1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,clock.instant());
        var first=postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,req).andExpect(status().isOk()).andReturn();
        clock.advance(5); change(s,2,State.AWAY,Reason.PRESENCE_LOST);
        var retry=postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,req).andExpect(status().isOk()).andExpect(jsonPath("$.duplicate").value(true)).andReturn();
        var expected=(tools.jackson.databind.node.ObjectNode)body(first); expected.put("duplicate",true);
        assertThat(body(retry)).isEqualTo(expected);
        assertThat(jdbc.queryForObject("select count(*) from monitoring_events where event_id=?",Long.class,req.eventId())).isEqualTo(1);
        var conflicting=new TransitionRequest(req.eventId(),1L,State.AWAY,Reason.PRESENCE_LOST,req.detectedAt(),null,null);
        postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,conflicting).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EVENT_ID_CONFLICT"));
    }
    @Test void sequenceRejectsOldValuesButAcceptsGaps() throws Exception {
        Session s=start(); clock.advance(1); change(s,5,State.AWAY,Reason.PRESENCE_LOST);
        for(long seq:List.of(1L,5L)) postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,request(seq,State.UNKNOWN,Reason.LOW_CONFIDENCE,clock.instant()))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SEQ_OUT_OF_ORDER"));
        assertThat(change(s,9,State.UNKNOWN,Reason.LOW_CONFIDENCE).seq()).isEqualTo(9);
    }
    @Test void futureClockRejectedPastClampedAndSmallFutureClamped() throws Exception {
        Session s=start();
        postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,request(1,State.AWAY,Reason.PRESENCE_LOST,clock.instant().plusSeconds(6)))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CLOCK_SKEW"));
        clock.advance(10);
        var clamped=sessions.transition(STUDENT,s.id(),request(1,State.AWAY,Reason.PRESENCE_LOST,s.startedAt().minusSeconds(60)));
        assertThat(clamped.effectiveAt()).isEqualTo(s.startedAt());
        var future=sessions.transition(STUDENT,s.id(),request(2,State.UNKNOWN,Reason.LOW_CONFIDENCE,clock.instant().plusSeconds(5)));
        assertThat(future.effectiveAt()).isEqualTo(clock.instant());
        var older=sessions.transition(STUDENT,s.id(),request(3,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,s.startedAt()));
        assertThat(older.effectiveAt()).isEqualTo(future.effectiveAt());
    }
    @Test void sameStateDoesNotSplitAndZeroLengthIntervalsAreRemoved() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        assertThat(count("activity_intervals")).isEqualTo(1);
        clock.advance(5); var same=change(s,2,State.FOCUS_ESTIMATED,Reason.FOCUS_RESUMED);
        assertThat(same.intervalChanged()).isFalse(); assertThat(same.currentStateSince()).isEqualTo(s.startedAt());
        assertThat(count("activity_intervals")).isEqualTo(1);
        change(s,3,State.AWAY,Reason.PRESENCE_LOST);
        assertThat(count("activity_intervals")).isEqualTo(2);
    }
    @Test void tenConcurrentIdenticalHttpPostsStoreExactlyOneEvent() throws Exception {
        Session s=start(); clock.advance(10); var req=request(1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,clock.instant());
        var executor=Executors.newFixedThreadPool(10); var gate=new CountDownLatch(1);
        try {
            List<Future<JsonNode>> futures=new ArrayList<>();
            for(int i=0;i<10;i++) futures.add(executor.submit(() -> { gate.await(); return body(postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,req).andExpect(status().isOk()).andReturn()); }));
            gate.countDown(); List<JsonNode> results=new ArrayList<>();
            for(var f:futures) results.add(f.get(20,TimeUnit.SECONDS));
            assertThat(results.stream().filter(r -> !r.get("duplicate").asBoolean()).count()).isEqualTo(1);
            assertThat(results.stream().map(r -> r.get("effectiveAt").asText()).distinct().count()).isEqualTo(1);
            assertThat(count("monitoring_events")).isEqualTo(2); assertThat(count("activity_intervals")).isEqualTo(2);
        } finally { executor.shutdownNow(); }
    }
    @Test void concurrentStartsLeaveOneActiveSessionAndOneOpenInterval() throws Exception {
        var executor=Executors.newFixedThreadPool(5);
        try {
            List<Future<Session>> futures=new ArrayList<>();
            for(int i=0;i<5;i++) futures.add(executor.submit(this::start));
            for(var f:futures) f.get(20,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("select count(*) from study_sessions where status='ACTIVE'",Long.class)).isEqualTo(1);
            assertThat(count("activity_intervals")).isEqualTo(1);
        } finally { executor.shutdownNow(); }
    }
    @Test void timeoutClosesAtVerifiedUntilAndReconnectPreservesUnknownGap() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        clock.advance(30); heartbeat(s,true); Instant verified=clock.instant();
        clock.advance(91); scheduler.scan();
        Report timed=reports.mine(STUDENT,DATE);
        assertThat(timed.currentState()).isEqualTo(State.UNKNOWN); assertThat(timed.currentStateSince()).isEqualTo(verified);
        assertThat(timed.totals().focusSeconds()).isEqualTo(30);
        assertThat(timed.intervals().getLast().reason()).isEqualTo(Reason.HEARTBEAT_TIMEOUT);
        assertThat(heartbeat(s,true).timedOut()).isTrue();
        // Queued onset cannot restore focus in the silent gap, only a fresh onset can.
        change(s,2,State.FOCUS_ESTIMATED,Reason.RECONNECTED); clock.advance(10);
        assertThat(reports.mine(STUDENT,DATE).totals().focusSeconds()).isEqualTo(40);
        assertThat(reports.mine(STUDENT,DATE).totals().unknownSeconds()).isEqualTo(91);
    }
    @Test void heartbeatOnReconnectRunsTimeoutBeforeUpdatingVerification() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(30); heartbeat(s,true);
        clock.advance(91); assertThat(heartbeat(s,true).timedOut()).isTrue();
        assertThat(reports.mine(STUDENT,DATE).totals().focusSeconds()).isEqualTo(30);
    }
    @Test void timeoutStrictBoundaryAndBreakAndUnknownRemainUntouched() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(90); scheduler.scan();
        assertThat(sessions.get(STUDENT,s.id()).currentState()).isEqualTo(State.FOCUS_ESTIMATED);
        clock.advance(1); scheduler.scan(); assertThat(sessions.get(STUDENT,s.id()).currentState()).isEqualTo(State.UNKNOWN);
        change(s,2,State.BREAK,Reason.BREAK_STARTED); clock.advance(100); scheduler.scan();
        assertThat(sessions.get(STUDENT,s.id()).currentState()).isEqualTo(State.BREAK);
    }
    @Test void cameraOffForcesUnknownCameraStoppedAndReplacementStillWorks() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(20);
        assertThat(heartbeat(s,false).currentState()).isEqualTo(State.UNKNOWN);
        Report report=reports.mine(STUDENT,DATE);
        assertThat(report.intervals().getLast().reason()).isEqualTo(Reason.CAMERA_STOPPED);
        assertThat(report.totals().focusSeconds()).isEqualTo(20);
        clock.advance(5); start(); assertThat(sessions.get(STUDENT,s.id()).endReason()).isEqualTo(Reason.SESSION_REPLACED);
    }
    @Test void staleOpenIntervalUsesVerifiedUntilAndGraceBoundaryIsInclusive() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(30); heartbeat(s,true);
        clock.advance(45); assertThat(reports.mine(STUDENT,DATE).totals().focusSeconds()).isEqualTo(75);
        clock.advance(1); Report report=reports.mine(STUDENT,DATE);
        assertThat(report.totals().focusSeconds()).isEqualTo(30); assertThat(report.currentStreakSeconds()).isEqualTo(30);
    }
    @Test void endIsIdempotentRestartIsDisjointAndEndedMutationFails() throws Exception {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(30);
        Session ended=sessions.end(STUDENT,s.id(),new EndRequest(clock.instant()));
        clock.advance(10); assertThat(sessions.end(STUDENT,s.id(),new EndRequest(clock.instant()))).isEqualTo(ended);
        Session next=start(); assertThat(next.id()).isNotEqualTo(s.id());
        postJson("/api/v1/study-sessions/"+s.id()+"/transitions",studentToken,request(2,State.AWAY,Reason.PRESENCE_LOST,clock.instant()))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SESSION_ENDED"));
        failure(() -> heartbeat(s,true),"SESSION_ENDED");
        assertThat(jdbc.queryForObject("select count(*) from activity_intervals a join activity_intervals b on a.student_id=b.student_id and a.id<>b.id and tstzrange(a.started_at,a.ended_at,'[)') && tstzrange(b.started_at,b.ended_at,'[)')",Long.class)).isZero();
    }
    @Test void replacementClosesAtVerificationAndEndClampsBothBounds() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(30); heartbeat(s,true);
        Instant verified=clock.instant(); clock.advance(30); Session next=start();
        Session replaced=sessions.get(STUDENT,s.id()); assertThat(replaced.endedAt()).isEqualTo(verified); assertThat(replaced.endReason()).isEqualTo(Reason.SESSION_REPLACED);
        assertThat(sessions.end(STUDENT,next.id(),new EndRequest(verified.minusSeconds(100))).endedAt()).isEqualTo(next.startedAt());
        Session last=start(); clock.advance(1); assertThat(sessions.end(STUDENT,last.id(),new EndRequest(clock.instant().plusSeconds(100))).endedAt()).isEqualTo(clock.instant());
    }
    @Test void databaseExclusionConstraintRejectsOverlappingRangeEvenAcrossSessions() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(30); sessions.end(STUDENT,s.id(),new EndRequest(clock.instant()));
        Session next=start();
        assertThatThrownBy(() -> jdbc.update("insert into activity_intervals (id,session_id,student_id,state,reason,started_at,ended_at,created_at) values (?,?,?,'AWAY','PRESENCE_LOST',?,?,?)",
            UUID.randomUUID(),next.id(),STUDENT,java.sql.Timestamp.from(s.startedAt().plusSeconds(10)),java.sql.Timestamp.from(s.startedAt().plusSeconds(20)),java.sql.Timestamp.from(clock.instant())))
            .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("activity_intervals_no_overlap");
    }
    @Test void totalsAndStreaksUseElapsedTimeAcrossAllStates() {
        Session s=start(); clock.advance(10); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        clock.advance(20); heartbeat(s,true); clock.advance(10); change(s,2,State.DISTRACTION_SUSPECTED,Reason.PHONE_SUSPECTED);
        clock.advance(15); change(s,3,State.AWAY,Reason.PRESENCE_LOST);
        clock.advance(5); change(s,4,State.BREAK,Reason.BREAK_STARTED);
        clock.advance(10); change(s,5,State.UNKNOWN,Reason.BREAK_ENDED);
        clock.advance(5); change(s,6,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        clock.advance(20); heartbeat(s,true);
        Report r=reports.mine(STUDENT,DATE);
        assertThat(r.totals()).isEqualTo(new Totals(50,15,5,15,10));
        assertThat(r.currentStreakSeconds()).isEqualTo(20); assertThat(r.longestStreakSeconds()).isEqualTo(30);
        clock.advance(20); heartbeat(s,true); r=reports.mine(STUDENT,DATE);
        assertThat(r.currentStreakSeconds()).isEqualTo(40); assertThat(r.longestStreakSeconds()).isEqualTo(40);
    }
    @Test void adjacentFocusAcrossSessionBoundaryFormsOneStreakAndFloorsAtEnd() {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED); clock.advance(20);
        sessions.end(STUDENT,s.id(),new EndRequest(clock.instant())); Session next=start(); change(next,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        clock.advance(10); Report report=reports.mine(STUDENT,DATE);
        assertThat(report.currentStreakSeconds()).isEqualTo(30); assertThat(report.longestStreakSeconds()).isEqualTo(30);
        assertThat(report.totals().focusSeconds()).isEqualTo(30);
    }
    @Test void intervalAttributionStaysOnSessionStudyDateAfterMidnight() {
        clock.set("2026-11-03T14:59:40Z"); Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        clock.advance(30); heartbeat(s,true);
        assertThat(reports.mine(STUDENT,DATE).totals().focusSeconds()).isEqualTo(30);
        assertThat(reports.mine(STUDENT,DATE.plusDays(1)).sessions()).isEmpty();
    }
    @Test void teacherListsOnlyAssignmentsAndUnassignedAccessIsForbidden() throws Exception {
        Session s=start();
        mvc.perform(get("/api/v1/teacher/students").header("Authorization","Bearer "+teacherToken)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        mvc.perform(get("/api/v1/teacher/students").header("Authorization","Bearer "+teacher2Token)).andExpect(status().isOk()).andExpect(jsonPath("$[0].student.email").value("student3@demo.local")).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/v1/teacher/students/"+STUDENT+"/study-days/"+DATE).header("Authorization","Bearer "+teacher2Token))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("STUDENT_NOT_ASSIGNED"));
        mvc.perform(get("/api/v1/study-sessions/"+s.id()).header("Authorization","Bearer "+teacherToken)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/study-sessions/"+s.id()).header("Authorization","Bearer "+teacher2Token)).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("STUDENT_NOT_ASSIGNED"));
        mvc.perform(get("/api/v1/study-sessions/"+s.id()).header("Authorization","Bearer "+token("student2@demo.local"))).andExpect(status().isForbidden());
        failure(() -> sessions.end(STUDENT2,s.id(),new EndRequest(clock.instant())),"FORBIDDEN");
    }
    static class RecordingEmitter extends SseEmitter {
        final List<Object> sent=new CopyOnWriteArrayList<>();
        @Override public void send(SseEventBuilder builder) { builder.build().forEach(item -> sent.add(item.getData())); }
        List<StreamEvent> events() { return sent.stream().filter(StreamEvent.class::isInstance).map(StreamEvent.class::cast).toList(); }
    }
    @Test void sseNotifiesStudentAndAssignedTeacherOnlyAfterCommitWithEventId() {
        Session s=start(); var student=new RecordingEmitter(); var teacher=new RecordingEmitter(); var other=new RecordingEmitter();
        streams.register(STUDENT,student); streams.register(TEACHER,teacher); streams.register(TEACHER2,other);
        clock.advance(5); var req=request(1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,clock.instant());
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            sessions.transition(STUDENT,s.id(),req); assertThat(teacher.events()).isEmpty();
        });
        assertThat(teacher.events()).singleElement().satisfies(e -> { assertThat(e.type()).isEqualTo(EventType.STATE_CHANGED); assertThat(e.state()).isEqualTo(State.FOCUS_ESTIMATED); });
        assertThat(student.events()).hasSize(1); assertThat(other.events()).isEmpty();
        String id=jdbc.queryForObject("select id::text from monitoring_events where event_id=?",String.class,req.eventId());
        assertThat(teacher.sent.toString()).contains("id:"+id).contains("event:monitoring").contains(": ping");
        streams.ping();
        assertThat(teacher.sent.toString()).contains(": ping");
    }
    @Test void rolledBackTransitionNeverPublishesAndFailedEmitterIsRemoved() {
        Session s=start(); var teacher=new RecordingEmitter(); streams.register(TEACHER,teacher);
        clock.advance(1);
        new TransactionTemplate(transactions).executeWithoutResult(tx -> { change(s,1,State.AWAY,Reason.PRESENCE_LOST); tx.setRollbackOnly(); });
        assertThat(teacher.events()).isEmpty(); assertThat(sessions.get(STUDENT,s.id()).currentState()).isEqualTo(State.UNKNOWN);
        int before=streams.subscriberCount();
        streams.register(STUDENT,new SseEmitter() { @Override public void send(SseEventBuilder builder) throws java.io.IOException { throw new java.io.IOException("closed"); } });
        assertThat(streams.subscriberCount()).isEqualTo(before);
    }
    @Test void replacementTakesServerTimeAfterWaitingForInFlightHeartbeat() throws Exception {
        Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        var executor=Executors.newFixedThreadPool(2); var locked=new CountDownLatch(1); var release=new CountDownLatch(1);
        try {
            var heartbeat=executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                store.session(s.id(),true); locked.countDown();
                try { if(!release.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting for release"); }
                catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                heartbeat(s,true);
            }));
            assertThat(locked.await(5,TimeUnit.SECONDS)).isTrue();
            var replacement=executor.submit(this::start);
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            int waiting=0;
            while(waiting==0 && System.nanoTime()<deadline) {
                waiting=jdbc.queryForObject("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%study_sessions%'",Integer.class);
                if(waiting==0) java.util.concurrent.locks.LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(10));
            }
            assertThat(waiting).as("replacement waits for the locked session").isPositive();
            clock.advance(30); release.countDown(); heartbeat.get(10,TimeUnit.SECONDS);
            Session next=replacement.get(10,TimeUnit.SECONDS);
            assertThat(next.startedAt()).isEqualTo(clock.instant());
            assertThat(sessions.get(STUDENT,s.id()).endedAt()).isEqualTo(next.startedAt());
        } finally { release.countDown(); executor.shutdownNow(); }
    }
    @Test void httpWorkflowPersistsOnlyContractDiagnosticsAndReturnsReports() throws Exception {
        var started=postJson("/api/v1/study-sessions",studentToken,
            new StartRequest(clock.instant(),new ClientInfo("demo-browser","v1",Backend.WORKER)))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.currentState").value("UNKNOWN"))
            .andExpect(jsonPath("$.heartbeatIntervalSec").value(30)).andExpect(jsonPath("$.heartbeatTimeoutSec").value(90)).andReturn();
        UUID id=UUID.fromString(body(started).get("id").asText());
        assertThat(jdbc.queryForObject("select client_info->>'inferenceBackend' from study_sessions where id=?",String.class,id)).isEqualTo("WORKER");
        clock.advance(15);
        var transition=new TransitionRequest(UUID.randomUUID(),1L,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,clock.instant(),0.9f,
            new Signals(true,true,false,0.9,0.8,0.0,true,true));
        postJson("/api/v1/study-sessions/"+id+"/transitions",studentToken,transition).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select (signals->>'faceDetected')::boolean from monitoring_events where event_id=?",Boolean.class,transition.eventId())).isTrue();
        clock.advance(30);
        postJson("/api/v1/study-sessions/"+id+"/heartbeat",studentToken,new HeartbeatRequest(clock.instant(),State.FOCUS_ESTIMATED,true,true,1L))
            .andExpect(status().isOk()).andExpect(jsonPath("$.timedOut").value(false));
        mvc.perform(get("/api/v1/me/study-days/"+DATE).header("Authorization","Bearer "+studentToken))
            .andExpect(status().isOk()).andExpect(jsonPath("$.totals.focusSeconds").value(30))
            .andExpect(jsonPath("$.timezone").value("Asia/Seoul")).andExpect(jsonPath("$.activeSessionId").value(id.toString()));
        mvc.perform(get("/api/v1/teacher/students/"+STUDENT+"/study-days/"+DATE).header("Authorization","Bearer "+teacherToken))
            .andExpect(status().isOk()).andExpect(jsonPath("$.totals.focusSeconds").value(30));
        postJson("/api/v1/study-sessions/"+id+"/end",studentToken,new EndRequest(clock.instant()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ENDED"));
    }
    @Test void fractionalDurationsAreSummedBeforeFlooringTotals() {
        clock.set("2026-11-03T00:00:00Z"); Session s=start(); change(s,1,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED);
        clock.set("2026-11-03T00:00:00.600Z"); change(s,2,State.AWAY,Reason.PRESENCE_LOST);
        clock.set("2026-11-03T00:00:01.200Z"); change(s,3,State.FOCUS_ESTIMATED,Reason.FOCUS_RESUMED);
        clock.set("2026-11-03T00:00:01.800Z"); sessions.end(STUDENT,s.id(),new EndRequest(clock.instant()));
        Report report=reports.mine(STUDENT,DATE);
        assertThat(report.totals().focusSeconds()).isEqualTo(1);
        assertThat(report.intervals().stream().mapToLong(Interval::durationSeconds).sum()).isZero();
    }
    @Test void eventKeyCannotBeReusedInAnotherSessionAndInvalidReasonHasFieldErrors() throws Exception {
        Session first=start(); var req=request(1,State.AWAY,Reason.PRESENCE_LOST,clock.instant());
        sessions.transition(STUDENT,first.id(),req); Session second=start();
        postJson("/api/v1/study-sessions/"+second.id()+"/transitions",studentToken,req)
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EVENT_ID_CONFLICT"));
        postJson("/api/v1/study-sessions/"+second.id()+"/transitions",studentToken,request(1,State.UNKNOWN,Reason.SESSION_STARTED,clock.instant()))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED")).andExpect(jsonPath("$.errors").isArray());
        assertThat(sessions.get(STUDENT,second.id()).lastSeq()).isZero();
    }
    @Test void maximumLengthWrongPasswordIsUnauthorizedRatherThanServerError() throws Exception {
        postJson("/api/v1/auth/login","unused",new LoginRequest("student1@demo.local","x".repeat(128)))
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("BAD_CREDENTIALS"));
    }
    @Test void shortUtf8JwtSecretFailsFast() {
        assertThatThrownBy(() -> new SecurityConfig().jwtKey(new AppConfig.JwtSettings("too-short",Duration.ofHours(1),"study-monitor")))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("at least 32 UTF-8 bytes");
    }
}
