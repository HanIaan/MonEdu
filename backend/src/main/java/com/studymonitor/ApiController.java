package com.studymonitor;

import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.time.*;
import java.util.*;
import static com.studymonitor.Api.*;

@RestController
@RequestMapping("/api/v1")
public class ApiController {
    private final AuthService auth; private final SessionService sessions; private final ReportService reports; private final SseHub streams;
    public ApiController(AuthService auth,SessionService sessions,ReportService reports,SseHub streams) {
        this.auth=auth; this.sessions=sessions; this.reports=reports; this.streams=streams;
    }
    private UUID id(Jwt jwt) { return UUID.fromString(jwt.getSubject()); }
    @GetMapping("/me") public User me(@AuthenticationPrincipal Jwt jwt) { return auth.me(id(jwt)); }
    @PostMapping("/study-sessions") @ResponseStatus(HttpStatus.CREATED) @PreAuthorize("hasRole('STUDENT')")
    public Session start(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody StartRequest request) { return sessions.start(id(jwt),request); }
    @GetMapping("/study-sessions/{sessionId}")
    public Session session(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID sessionId) { return sessions.get(id(jwt),sessionId); }
    @PostMapping("/study-sessions/{sessionId}/transitions") @PreAuthorize("hasRole('STUDENT')")
    public TransitionResponse transition(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID sessionId,@Valid @RequestBody TransitionRequest request) { return sessions.transition(id(jwt),sessionId,request); }
    @PostMapping("/study-sessions/{sessionId}/heartbeat") @PreAuthorize("hasRole('STUDENT')")
    public HeartbeatResponse heartbeat(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID sessionId,@Valid @RequestBody HeartbeatRequest request) { return sessions.heartbeat(id(jwt),sessionId,request); }
    @PostMapping("/study-sessions/{sessionId}/end") @PreAuthorize("hasRole('STUDENT')")
    public Session end(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID sessionId,@Valid @RequestBody EndRequest request) { return sessions.end(id(jwt),sessionId,request); }
    @GetMapping("/me/study-days/{date}")
    public Report mine(@AuthenticationPrincipal Jwt jwt,@PathVariable LocalDate date) { return reports.mine(id(jwt),date); }
    @GetMapping("/teacher/students")
    public List<Overview> students(@AuthenticationPrincipal Jwt jwt) { return reports.students(id(jwt)); }
    @GetMapping("/teacher/students/{studentId}/study-days/{date}")
    public Report report(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID studentId,@PathVariable LocalDate date) { return reports.teacher(id(jwt),studentId,date); }
    @GetMapping(value="/me/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter mineStream(@AuthenticationPrincipal Jwt jwt) { return streams.subscribe(id(jwt)); }
    @GetMapping(value="/teacher/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter teacherStream(@AuthenticationPrincipal Jwt jwt) { return streams.subscribe(id(jwt)); }
}
