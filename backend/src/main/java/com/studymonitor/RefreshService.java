package com.studymonitor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import java.security.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class RefreshService {
    public record Issued(String token,Api.LoginResponse login) {}
    private record Token(UUID id,UUID user,UUID family,Instant issued,Instant expires,Instant revoked,UUID replacement) {}
    private final JdbcTemplate db; private final Store store; private final Clock clock;
    private final AuthService auth; private final AppConfig.Auth settings;
    private final SecureRandom random=new SecureRandom();
    public RefreshService(JdbcTemplate db,Store store,Clock clock,AuthService auth,AppConfig.Auth settings) {
        this.db=db; this.store=store; this.clock=clock; this.auth=auth; this.settings=settings;
    }
    public static String hash(String raw) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8))); }
        catch(NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    static java.sql.Timestamp timestamp(Instant time) { return java.sql.Timestamp.from(time); }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    @Transactional
    public Issued issue(UUID user,String agent) {
        String raw=insert(UUID.randomUUID(),user,UUID.randomUUID(),now(),agent);
        return new Issued(raw,auth.tokens(store.account(user)));
    }
    private String insert(UUID id,UUID user,UUID family,Instant issued,String agent) {
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String raw=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.update("insert into refresh_tokens(id,user_id,family_id,token_hash,issued_at,expires_at,user_agent) values (?,?,?,?,?,?,?)",
            id,user,family,hash(raw),timestamp(issued),timestamp(issued.plus(settings.refreshTtl())),agent==null?null:agent.substring(0,Math.min(256,agent.length())));
        return raw;
    }
    private Token find(String raw) {
        if(raw==null || raw.isBlank()) return null;
        List<Token> tokens=db.query("select * from refresh_tokens where token_hash=?",(rs,n) -> new Token(rs.getObject("id",UUID.class),rs.getObject("user_id",UUID.class),
            rs.getObject("family_id",UUID.class),rs.getTimestamp("issued_at").toInstant(),rs.getTimestamp("expires_at").toInstant(),
            rs.getTimestamp("revoked_at")==null?null:rs.getTimestamp("revoked_at").toInstant(),rs.getObject("replaced_by",UUID.class)),hash(raw));
        return tokens.isEmpty()?null:tokens.getFirst();
    }
    private void lock(UUID family) { db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))","refresh:"+family); }
    private Failure invalid() { return fail(UNAUTHORIZED,"UNAUTHORIZED","유효한 로그인 세션이 없습니다."); }
    private void revoke(UUID family) {
        // Clearing rotation pointers also disables grace for explicit logout / family revocation.
        db.update("update refresh_tokens set revoked_at=coalesce(revoked_at,?),replaced_by=null where family_id=?",timestamp(now()),family);
    }
    @Transactional(noRollbackFor=Failure.class)
    public Issued rotate(String raw,String agent) {
        Token token=find(raw); if(token==null) throw invalid();
        lock(token.family()); token=find(raw); Instant now=now();
        Instant issued=now;
        if(token.revoked()!=null) {
            if(!now.isBefore(token.revoked().plus(settings.refreshReuseGrace()))) { revoke(token.family()); throw invalid(); }
            if(token.replacement()==null) throw invalid();
            Instant replacementIssued=db.queryForObject("select issued_at from refresh_tokens where id=?",(rs,n)->rs.getTimestamp(1).toInstant(),token.replacement());
            // First rotation has identical revoked_at / successor issued_at. Grace replaces that
            // pointer with a strictly later successor, durably recording its single use without
            // extra schema fields. Microsecond ordering survives PostgreSQL timestamp precision.
            if(!token.revoked().equals(replacementIssued)) throw invalid();
            if(!issued.isAfter(token.revoked())) issued=token.revoked().plus(1,ChronoUnit.MICROS);
        }
        if(!now.isBefore(token.expires())) throw invalid();
        UUID next=UUID.randomUUID(); String replacement=insert(next,token.user(),token.family(),issued,agent);
        db.update("update refresh_tokens set revoked_at=coalesce(revoked_at,?),replaced_by=? where id=?",timestamp(now),next,token.id());
        return new Issued(replacement,auth.tokens(store.account(token.user())));
    }
    @Transactional
    public void logout(String raw) {
        Token token=find(raw); if(token==null) return;
        lock(token.family()); revoke(token.family());
    }
}
