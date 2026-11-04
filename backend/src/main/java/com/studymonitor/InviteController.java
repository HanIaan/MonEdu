package com.studymonitor;

import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import jakarta.validation.Valid;
import java.util.*;
import static com.studymonitor.Api.*;

@RestController
@RequestMapping("/api/v1")
public class InviteController {
    private final InviteService invites;
    public InviteController(InviteService invites) { this.invites=invites; }
    @GetMapping("/teacher/invite-code") public InviteCode code(@AuthenticationPrincipal Jwt jwt) { return invites.code(UUID.fromString(jwt.getSubject()),false); }
    @PostMapping("/teacher/invite-code/rotate") public InviteCode rotate(@AuthenticationPrincipal Jwt jwt) { return invites.code(UUID.fromString(jwt.getSubject()),true); }
    @GetMapping("/me/teachers") public List<TeacherLink> list(@AuthenticationPrincipal Jwt jwt) { return invites.list(UUID.fromString(jwt.getSubject())); }
    @PostMapping("/me/teachers") public TeacherLink join(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody JoinTeacherRequest request) { return invites.join(UUID.fromString(jwt.getSubject()),request.inviteCode()); }
}
