package com.studymonitor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import java.time.*;
import java.util.*;
import static com.studymonitor.Api.*;
import static com.studymonitor.Domain.*;

@Service
public class ReportService {
    private final Store store; private final AuthService auth; private final Clock clock; private final AppConfig.Monitoring config;
    private static final ZoneId SEOUL=ZoneId.of("Asia/Seoul");
    public ReportService(Store store,AuthService auth,Clock clock,AppConfig.Monitoring config) {
        this.store=store; this.auth=auth; this.clock=clock; this.config=config;
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Report mine(UUID student,LocalDate date) { auth.student(student); return compute(student,date,clock.instant()); }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Report teacher(UUID teacher,UUID student,LocalDate date) { auth.assigned(teacher,student); return compute(student,date,clock.instant()); }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public List<Overview> students(UUID teacher) {
        if(auth.me(teacher).role()!=Role.TEACHER) throw Problems.fail(org.springframework.http.HttpStatus.FORBIDDEN,"FORBIDDEN","Teacher access required");
        Instant now=clock.instant(); LocalDate date=now.atZone(SEOUL).toLocalDate();
        List<Account> accounts=store.students(teacher);
        List<UUID> ids=accounts.stream().map(account -> account.id).toList();
        List<StudySession> day=store.dayForStudents(ids,date);
        Map<UUID,List<StudySession>> days=new HashMap<>();
        day.forEach(s -> days.computeIfAbsent(s.studentId,key -> new ArrayList<>()).add(s));
        Map<UUID,List<ActivityInterval>> intervals=new HashMap<>();
        store.intervals(day.stream().map(s -> s.id).toList()).forEach(i ->
            intervals.computeIfAbsent(i.studentId,key -> new ArrayList<>()).add(i));
        Map<UUID,StudySession> activeSessions=new HashMap<>();
        store.activeForStudents(ids).forEach(s -> activeSessions.put(s.studentId,s));
        return accounts.stream().map(account -> {
            Report r=compute(account,date,now,days.getOrDefault(account.id,List.of()),intervals.getOrDefault(account.id,List.of()));
            StudySession active=activeSessions.get(account.id);
            return new Overview(account.view(),active==null?null:active.id,active==null?null:active.currentState,
                                active==null?null:active.currentStateSince,active==null?null:active.lastHeartbeatAt,
                                new Today(date,r.firstSeatedAt(),r.lateSeconds(),r.lateStatus(),r.totals(),r.currentStreakSeconds(),r.longestStreakSeconds()));
        }).toList();
    }
    private Report compute(UUID student,LocalDate date,Instant now) {
        List<StudySession> sessions=store.day(student,date);
        return compute(store.account(student),date,now,sessions,store.intervals(sessions.stream().map(s -> s.id).toList()));
    }
    private Report compute(Account account,LocalDate date,Instant now,List<StudySession> sessions,List<ActivityInterval> intervals) {
        Map<UUID,StudySession> byId=new HashMap<>(); sessions.forEach(s -> byId.put(s.id,s));
        EnumMap<State,Duration> totals=new EnumMap<>(State.class);
        for(State state:State.values()) totals.put(state,Duration.ZERO);
        Instant first=null,previousEnd=null; Duration streak=Duration.ZERO,longest=Duration.ZERO,current=Duration.ZERO;
        List<Interval> views=new ArrayList<>();
        for(ActivityInterval i:intervals) {
            StudySession s=byId.get(i.sessionId);
            Instant end=i.endedAt;
            if(end==null) end=Duration.between(s.verifiedUntil,now).compareTo(config.liveEndGrace())<=0?now:s.verifiedUntil;
            end=SessionService.max(end,i.startedAt);
            Duration duration=Duration.between(i.startedAt,end);
            totals.put(i.state,totals.get(i.state).plus(duration));
            views.add(new Interval(i.id,i.sessionId,i.state,i.reason,i.startedAt,i.endedAt,duration.toSeconds(),i.endedAt==null));
            if(first==null && (i.state==State.FOCUS_ESTIMATED || i.state==State.DISTRACTION_SUSPECTED)) first=i.startedAt;
            if(i.state==State.FOCUS_ESTIMATED) {
                if(!i.startedAt.equals(previousEnd)) streak=Duration.ZERO;
                streak=streak.plus(duration);
                if(streak.compareTo(longest)>0) longest=streak;
                if(i.endedAt==null) current=streak;
                previousEnd=end;
            } else { streak=Duration.ZERO; previousEnd=null; }
        }
        Instant reference=date.atTime(9,0).atZone(SEOUL).toInstant();
        Long late=first==null?null:Math.max(0,Duration.between(reference,first).getSeconds());
        StudySession active=sessions.stream().filter(s -> s.status==Status.ACTIVE).findFirst().orElse(null);
        return new Report(account.id,account.displayName,date,"Asia/Seoul",reference,first,late,
            first==null?LateStatus.NOT_SEATED:late==0?LateStatus.ON_TIME:LateStatus.LATE,
            new Totals(totals.get(State.FOCUS_ESTIMATED).toSeconds(),totals.get(State.DISTRACTION_SUSPECTED).toSeconds(),
                       totals.get(State.AWAY).toSeconds(),totals.get(State.UNKNOWN).toSeconds(),totals.get(State.BREAK).toSeconds()),
            current.toSeconds(),longest.toSeconds(),active==null?null:active.currentState,active==null?null:active.currentStateSince,
            active==null?null:active.id,sessions.stream().map(s -> new SessionSummary(s.id,s.status,s.startedAt,s.endedAt,s.endReason)).toList(),views,now);
    }
}
