package com.studymonitor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import java.time.*;
import java.util.*;
import static com.studymonitor.Api.*;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class AuthService {
    private final Store store; private final PasswordEncoder passwords; private final JwtEncoder encoder;
    private final Clock clock; private final AppConfig.JwtSettings settings;
    private final String dummyHash;
    public AuthService(Store store,PasswordEncoder passwords,JwtEncoder encoder,Clock clock,AppConfig.JwtSettings settings) {
        this.store=store; this.passwords=passwords; this.encoder=encoder; this.clock=clock; this.settings=settings;
        dummyHash=passwords.encode(UUID.randomUUID().toString());
    }
    @Transactional(readOnly=true)
    public LoginResponse login(LoginRequest request) {
        Domain.Account user=store.accountByEmail(request.email().toLowerCase(Locale.ROOT)).orElse(null);
        boolean valid=passwords.matches(request.password(),user==null ? dummyHash : user.passwordHash);
        if(user==null || !valid) throw fail(UNAUTHORIZED,"BAD_CREDENTIALS","Invalid email or password");
        Instant now=clock.instant();
        JwtClaimsSet claims=JwtClaimsSet.builder().issuer(settings.issuer()).subject(user.id.toString())
            .issuedAt(now).expiresAt(now.plus(settings.ttl())).claim("role",user.role.name()).build();
        String token=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),claims)).getTokenValue();
        return new LoginResponse(token,"Bearer",settings.ttl().toSeconds(),user.view());
    }
    @Transactional(readOnly=true)
    public User me(UUID id) {
        Domain.Account account=store.account(id);
        if(account==null) throw fail(UNAUTHORIZED,"UNAUTHORIZED","Account no longer exists");
        return account.view();
    }
    public void student(UUID id) {
        Domain.Account account=store.account(id);
        if(account==null || account.role!=Role.STUDENT) throw fail(FORBIDDEN,"FORBIDDEN","Student access required");
    }
    public void canRead(UUID viewer,UUID student) {
        Domain.Account account=store.account(viewer);
        if(account!=null && account.role==Role.STUDENT && viewer.equals(student)) return;
        if(account!=null && account.role==Role.TEACHER) { assigned(viewer,student); return; }
        throw fail(FORBIDDEN,"FORBIDDEN","Session belongs to another student");
    }
    public void assigned(UUID teacher,UUID student) {
        Domain.Account account=store.account(teacher);
        if(account==null || account.role!=Role.TEACHER) throw fail(FORBIDDEN,"FORBIDDEN","Teacher access required");
        if(!store.assigned(teacher,student)) throw fail(FORBIDDEN,"STUDENT_NOT_ASSIGNED","Student is not assigned to this teacher");
    }
}
