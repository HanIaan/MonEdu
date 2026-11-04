package com.studymonitor;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;

/** Wire types mirror docs/contracts/openapi.yaml. No media or unconstrained diagnostics. */
public final class Api {
    private Api() {}
    public enum Role { STUDENT, TEACHER }
    public enum State { FOCUS_ESTIMATED, DISTRACTION_SUSPECTED, AWAY, UNKNOWN, BREAK }
    public enum Reason { SESSION_STARTED, SEATED_CONFIRMED, FOCUS_RESUMED, PRESENCE_LOST,
        PHONE_SUSPECTED, DROWSINESS_SUSPECTED, LOW_CONFIDENCE, CAMERA_STOPPED, CAMERA_PERMISSION_DENIED,
        INFERENCE_STALLED, MODEL_ERROR, MONITORING_PAUSED, BREAK_STARTED, BREAK_ENDED,
        RECONNECTED, HEARTBEAT_TIMEOUT, SESSION_ENDED, SESSION_REPLACED }
    public enum Status { ACTIVE, ENDED }
    public enum Backend { WORKER, MAIN_THREAD }
    public enum LateStatus { ON_TIME, LATE, NOT_SEATED }
    public enum EventType { STATE_CHANGED, SESSION_STARTED, SESSION_ENDED }
    public record User(UUID id, String email, String displayName, Role role) {}
    public record LoginRequest(@NotBlank @Email @Size(max=254) String email,
                               @NotBlank @Size(max=128) String password) {}
    public record LoginResponse(String accessToken, String tokenType, long expiresIn, User user) {}
    public record Agreements(@NotNull(message="이용약관에 동의해 주세요.") @AssertTrue(message="이용약관에 동의해 주세요.") Boolean terms,
                             @NotNull(message="개인정보 처리방침에 동의해 주세요.") @AssertTrue(message="개인정보 처리방침에 동의해 주세요.") Boolean privacy) {}
    public record SignupRequest(@NotBlank(message="이메일을 입력해 주세요.") @Email(message="올바른 이메일을 입력해 주세요.") @Size(max=254,message="이메일은 254자 이하여야 합니다.") String email,
                                String password, String displayName, @NotNull(message="역할을 선택해 주세요.") Role role,
                                @NotNull(message="약관 동의가 필요합니다.") @Valid Agreements agreements) {}
    public record KakaoCompleteRequest(String displayName, @NotNull(message="역할을 선택해 주세요.") Role role,
                                       @NotNull(message="약관 동의가 필요합니다.") @Valid Agreements agreements) {}
    /** Account deletion: password accounts re-enter their password; Kakao-only accounts confirm only. */
    public record DeleteAccountRequest(@Size(max=1024) String password,
                                       @NotNull(message="탈퇴 확인이 필요합니다.") @AssertTrue(message="탈퇴 확인이 필요합니다.") Boolean confirm) {}
    public record AuthProviders(boolean password, boolean kakao) {}
    public record KakaoPending(String nickname) {}
    public record InviteCode(String code, Instant createdAt) {}
    public record JoinTeacherRequest(@NotBlank(message="초대 코드를 입력해 주세요.") @Size(max=32,message="초대 코드는 32자 이하여야 합니다.") String inviteCode) {}
    public record TeacherSummary(UUID id, String displayName) {}
    public record TeacherLink(TeacherSummary teacher, Instant linkedAt) {}
    public record ClientInfo(@Size(max=512) String userAgent, @Size(max=64) String engineVersion,
                             Backend inferenceBackend) {}
    public record StartRequest(@NotNull Instant clientStartedAt, @Valid ClientInfo clientInfo) {}
    public record Signals(Boolean faceDetected, Boolean upperBodyDetected, Boolean phoneDetected,
                          @DecimalMin("0") @DecimalMax("1") Double faceScore,
                          @DecimalMin("0") @DecimalMax("1") Double poseScore,
                          @DecimalMin("0") @DecimalMax("1") Double phoneScore,
                          Boolean cameraActive, Boolean pageVisible) {}
    public record TransitionRequest(@NotNull UUID eventId, @NotNull @Min(1) Long seq,
                                    @NotNull State state, @NotNull Reason reason,
                                    @NotNull Instant detectedAt,
                                    @DecimalMin("0") @DecimalMax("1") Float confidence,
                                    @Valid Signals signals) {}
    public record TransitionResponse(UUID eventId, long seq, boolean duplicate, Instant serverReceivedAt,
                                     Instant effectiveAt, State currentState, Instant currentStateSince,
                                     boolean intervalChanged) {
        public TransitionResponse replay() {
            return new TransitionResponse(eventId, seq, true, serverReceivedAt, effectiveAt,
                                          currentState, currentStateSince, intervalChanged);
        }
    }
    public record HeartbeatRequest(@NotNull Instant sentAt, @NotNull State clientState,
                                   @NotNull Boolean cameraActive, @NotNull Boolean pageVisible,
                                   @NotNull @Min(0) Long lastSeq) {}
    public record HeartbeatResponse(Instant serverTime, State currentState, Instant currentStateSince,
                                    long lastSeq, boolean timedOut, long heartbeatIntervalSec) {}
    public record EndRequest(@NotNull Instant endedAt) {}
    public record Session(UUID id, UUID studentId, Status status, LocalDate studyDate, Instant startedAt,
                          Instant endedAt, Reason endReason, State currentState, Instant currentStateSince,
                          long lastSeq, Instant lastHeartbeatAt, Instant verifiedUntil,
                          long heartbeatIntervalSec, long heartbeatTimeoutSec) {}
    public record Totals(long focusSeconds, long distractionSeconds, long awaySeconds,
                         long unknownSeconds, long breakSeconds) {}
    public record Interval(UUID id, UUID sessionId, State state, Reason reason, Instant startedAt,
                           Instant endedAt, long durationSeconds, boolean open) {}
    public record SessionSummary(UUID id, Status status, Instant startedAt, Instant endedAt, Reason endReason) {}
    public record Report(UUID studentId, String studentName, LocalDate date, String timezone,
                         Instant referenceTime, Instant firstSeatedAt, Long lateSeconds, LateStatus lateStatus,
                         Totals totals, long currentStreakSeconds, long longestStreakSeconds,
                         State currentState, Instant currentStateSince, UUID activeSessionId,
                         List<SessionSummary> sessions, List<Interval> intervals, Instant computedAt) {}
    public record Today(LocalDate date, Instant firstSeatedAt, Long lateSeconds, LateStatus lateStatus,
                        Totals totals, long currentStreakSeconds, long longestStreakSeconds) {}
    public record Overview(User student, UUID activeSessionId, State currentState, Instant currentStateSince,
                           Instant lastHeartbeatAt, Today today) {}
    public record StreamEvent(EventType type, UUID studentId, UUID sessionId, State state, Reason reason, Instant at) {}
}
