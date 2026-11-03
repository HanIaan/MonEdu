package com.studymonitor;

import jakarta.persistence.*;
import org.springframework.stereotype.Repository;
import java.time.*;
import java.util.*;
import static com.studymonitor.Domain.*;

/** All mutation callers run in a service transaction; session locks serialize event retries. */
@Repository
public class Store {
    @PersistenceContext EntityManager em;
    public <T> void add(T entity) { em.persist(entity); }
    public void flush() { em.flush(); }
    public void remove(Object entity) { em.remove(entity); }
    public Account account(UUID id) { return em.find(Account.class,id); }
    public Account lockAccount(UUID id) { return em.find(Account.class,id,LockModeType.PESSIMISTIC_WRITE); }
    public Optional<Account> accountByEmail(String email) {
        return em.createQuery("from Account where email=:email",Account.class).setParameter("email",email).getResultStream().findFirst();
    }
    public boolean assigned(UUID teacher, UUID student) { return em.find(Assignment.class,new AssignmentId(teacher,student)) != null; }
    public List<UUID> teachers(UUID student) {
        return em.createQuery("select a.id.teacherId from Assignment a where a.id.studentId=:id",UUID.class).setParameter("id",student).getResultList();
    }
    public List<Account> students(UUID teacher) {
        return em.createQuery("select u from Account u, Assignment a where a.id.studentId=u.id and a.id.teacherId=:id and u.role=:role order by u.email",Account.class).setParameter("id",teacher).setParameter("role",Api.Role.STUDENT).getResultList();
    }
    public StudySession session(UUID id, boolean lock) {
        return lock ? em.find(StudySession.class,id,LockModeType.PESSIMISTIC_WRITE) : em.find(StudySession.class,id);
    }
    public Optional<StudySession> activeForUpdate(UUID student) {
        // Acquire the lock as the row is loaded; upgrading a previously read entity can retain stale fields.
        return em.createQuery("from StudySession where studentId=:id and status='ACTIVE'",StudySession.class)
            .setParameter("id",student).setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultStream().findFirst();
    }
    public Optional<StudySession> active(UUID student) {
        return em.createQuery("from StudySession where studentId=:id and status='ACTIVE'",StudySession.class).setParameter("id",student).getResultStream().findFirst();
    }
    public List<StudySession> day(UUID student, LocalDate date) {
        return em.createQuery("from StudySession where studentId=:id and studyDate=:date order by startedAt,id",StudySession.class).setParameter("id",student).setParameter("date",date).getResultList();
    }
    public List<UUID> expired(Instant cutoff) {
        return em.createQuery("select id from StudySession where status='ACTIVE' and currentState not in ('UNKNOWN','BREAK') and coalesce(lastHeartbeatAt,startedAt)<:cutoff",UUID.class).setParameter("cutoff",cutoff).getResultList();
    }
    public ActivityInterval open(UUID session) {
        return em.createQuery("from ActivityInterval where sessionId=:id and endedAt is null",ActivityInterval.class).setParameter("id",session).getSingleResult();
    }
    public List<ActivityInterval> intervals(List<UUID> sessions) {
        if(sessions.isEmpty()) return List.of();
        return em.createQuery("from ActivityInterval where sessionId in :ids order by startedAt,id",ActivityInterval.class).setParameter("ids",sessions).getResultList();
    }
    public void lockEventKey(UUID eventId) {
        // event_id is globally unique, including attempts to reuse a key across sessions.
        em.unwrap(org.hibernate.Session.class).doWork(connection -> {
            try (var statement=connection.prepareStatement("select pg_advisory_xact_lock(?)")) {
                statement.setLong(1,eventId.getMostSignificantBits() ^ eventId.getLeastSignificantBits());
                statement.execute();
            }
        });
    }
    public Optional<MonitoringEvent> event(UUID eventId) {
        return em.createQuery("from MonitoringEvent where eventId=:id",MonitoringEvent.class).setParameter("id",eventId).getResultStream().findFirst();
    }
}
