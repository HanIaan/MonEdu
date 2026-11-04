package com.studymonitor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.*;
import java.util.*;
import static com.studymonitor.Api.*;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class AccountService {
    private final Store store; private final JdbcTemplate db; private final Clock clock;
    private final PasswordEncoder passwords; private final AccountPolicy policy; private final AppConfig.Auth settings;
    public AccountService(Store store,JdbcTemplate db,Clock clock,PasswordEncoder passwords,AccountPolicy policy,AppConfig.Auth settings) {
        this.store=store; this.db=db; this.clock=clock; this.passwords=passwords; this.policy=policy; this.settings=settings;
    }
    @Transactional
    public Domain.Account signup(SignupRequest request) {
        String email=request.email().toLowerCase(Locale.ROOT);
        policy.password(email,request.password());
        String name=policy.displayName(request.displayName()); policy.agreements(request.agreements());
        // Serialize even when the email has no row yet; the UNIQUE index remains the final guard.
        db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))","email:"+email);
        if(store.accountByEmail(email).isPresent()) throw fail(CONFLICT,"EMAIL_TAKEN","이미 사용 중인 이메일입니다.");
        Domain.Account user=create(name,request.role()); user.email=email; user.passwordHash=passwords.encode(request.password());
        store.add(user); store.flush(); return user;
    }
    Domain.Account create(String displayName,Role role) {
        Domain.Account user=new Domain.Account(); user.id=UUID.randomUUID(); user.displayName=displayName; user.role=role;
        user.createdAt=clock.instant(); user.termsAgreedAt=user.createdAt; user.privacyAgreedAt=user.createdAt;
        user.agreementsVersion=settings.agreementsVersion(); return user;
    }
    @Transactional(readOnly=true)
    public Domain.Account identity(String kakaoId) {
        List<UUID> ids=db.query("select user_id from user_identities where provider='KAKAO' and provider_user_id=?",(rs,n) -> rs.getObject(1,UUID.class),kakaoId);
        return ids.isEmpty()?null:store.account(ids.getFirst());
    }
    @Transactional
    public Domain.Account complete(String kakaoId,KakaoCompleteRequest request) {
        String name=policy.displayName(request.displayName()); policy.agreements(request.agreements());
        db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))","kakao:"+kakaoId);
        Domain.Account existing=identity(kakaoId); if(existing!=null) return existing;
        Domain.Account user=create(name,request.role()); store.add(user); store.flush();
        db.update("insert into user_identities(provider,provider_user_id,user_id,created_at) values ('KAKAO',?,?,?)",
            kakaoId,user.id,java.sql.Timestamp.from(clock.instant()));
        return user;
    }
}
