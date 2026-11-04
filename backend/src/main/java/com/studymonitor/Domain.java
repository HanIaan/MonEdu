package com.studymonitor;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.io.Serializable;
import java.time.*;
import java.util.*;
import static com.studymonitor.Api.*;

/** Persistence fields are intentionally separate from API response types. */
public final class Domain {
    private Domain() {}
    @Entity(name="Account") @Table(name="users")
    public static class Account {
        @Id public UUID id;
        @Column(length=254) public String email;
        @Column(name="password_hash", length=100) public String passwordHash;
        @Column(name="display_name", nullable=false, length=100) public String displayName;
        @Enumerated(EnumType.STRING) @Column(nullable=false, length=16) public Role role;
        @Column(name="created_at", nullable=false) public Instant createdAt;
        @Column(name="terms_agreed_at") public Instant termsAgreedAt;
        @Column(name="privacy_agreed_at") public Instant privacyAgreedAt;
        @Column(name="agreements_version", length=32) public String agreementsVersion;
        public User view() { return new User(id, email, displayName, role); }
    }
    @Embeddable
    public static class AssignmentId implements Serializable {
        @Column(name="teacher_id") public UUID teacherId;
        @Column(name="student_id") public UUID studentId;
        public AssignmentId() {}
        public AssignmentId(UUID teacherId, UUID studentId) { this.teacherId=teacherId; this.studentId=studentId; }
        @Override public boolean equals(Object o) { return o instanceof AssignmentId a && Objects.equals(teacherId,a.teacherId) && Objects.equals(studentId,a.studentId); }
        @Override public int hashCode() { return Objects.hash(teacherId,studentId); }
    }
    @Entity(name="Assignment") @Table(name="teacher_students")
    public static class Assignment {
        @EmbeddedId public AssignmentId id;
        @Column(name="created_at", nullable=false) public Instant createdAt;
    }
    @Entity(name="StudySession") @Table(name="study_sessions")
    public static class StudySession {
        @Id public UUID id;
        @Column(name="student_id", nullable=false) public UUID studentId;
        @Enumerated(EnumType.STRING) @Column(nullable=false, length=16) public Status status;
        @Column(name="study_date", nullable=false) public LocalDate studyDate;
        @Column(name="started_at", nullable=false) public Instant startedAt;
        @Column(name="ended_at") public Instant endedAt;
        @Enumerated(EnumType.STRING) @Column(name="end_reason", length=32) public Reason endReason;
        @Enumerated(EnumType.STRING) @Column(name="current_state", nullable=false, length=32) public State currentState;
        @Column(name="current_state_since", nullable=false) public Instant currentStateSince;
        @Column(name="last_seq", nullable=false) public long lastSeq;
        @Column(name="last_heartbeat_at") public Instant lastHeartbeatAt;
        @Column(name="verified_until", nullable=false) public Instant verifiedUntil;
        @JdbcTypeCode(SqlTypes.JSON) @Column(name="client_info", columnDefinition="jsonb") public String clientInfo;
        @Version public long version;
        @Column(name="created_at", nullable=false) public Instant createdAt;
    }
    @Entity(name="ActivityInterval") @Table(name="activity_intervals")
    public static class ActivityInterval {
        @Id public UUID id;
        @Column(name="session_id", nullable=false) public UUID sessionId;
        @Column(name="student_id", nullable=false) public UUID studentId;
        @Enumerated(EnumType.STRING) @Column(nullable=false, length=32) public State state;
        @Enumerated(EnumType.STRING) @Column(nullable=false, length=32) public Reason reason;
        @Column(name="started_at", nullable=false) public Instant startedAt;
        @Column(name="ended_at") public Instant endedAt;
        @Column(name="opened_by_event_id") public UUID openedByEventId;
        @Column(name="created_at", nullable=false) public Instant createdAt;
    }
    @Entity(name="MonitoringEvent") @Table(name="monitoring_events")
    public static class MonitoringEvent {
        @Id public UUID id;
        @Column(name="session_id", nullable=false) public UUID sessionId;
        @Column(name="student_id", nullable=false) public UUID studentId;
        @Column(name="event_id") public UUID eventId;
        public Long seq;
        @Column(nullable=false, length=8) public String source;
        @Enumerated(EnumType.STRING) @Column(nullable=false, length=32) public State state;
        @Enumerated(EnumType.STRING) @Column(nullable=false, length=32) public Reason reason;
        @Column(name="detected_at") public Instant detectedAt;
        @Column(name="effective_at", nullable=false) public Instant effectiveAt;
        @Column(name="server_received_at", nullable=false) public Instant serverReceivedAt;
        public Float confidence;
        @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb") public String signals;
        @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb") public String response;
    }
}
