package com.studymonitor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import static com.studymonitor.Api.*;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class InviteService {
    private final JdbcTemplate db; private final Store store; private final Clock clock; private final AuthService auth; private final AuthThrottle throttle;
    private final SecureRandom random=new SecureRandom();
    private static final String ALPHABET="23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    public InviteService(JdbcTemplate db,Store store,Clock clock,AuthService auth,AuthThrottle throttle) {
        this.db=db; this.store=store; this.clock=clock; this.auth=auth; this.throttle=throttle;
    }
    @Transactional
    public InviteCode code(UUID teacher,boolean rotate) {
        db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))","invite:"+teacher);
        Domain.Account user=store.account(teacher);
        if(user==null || user.role!=Role.TEACHER) throw fail(FORBIDDEN,"FORBIDDEN","Teacher access required");
        var codes=db.query("select code,created_at from teacher_invite_codes where teacher_id=? and revoked_at is null",(rs,n)->new InviteCode(rs.getString(1),rs.getTimestamp(2).toInstant()),teacher);
        if(!rotate && !codes.isEmpty()) return codes.getFirst();
        Instant now=clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        if(!codes.isEmpty()) db.update("update teacher_invite_codes set revoked_at=? where teacher_id=? and revoked_at is null",RefreshService.timestamp(now),teacher);
        while(true) {
            StringBuilder next=new StringBuilder(); for(int i=0;i<8;i++) next.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
            // ON CONFLICT preserves all historical codes, including the unlikely random collision.
            if(db.update("insert into teacher_invite_codes(code,teacher_id,created_at) values (?,?,?) on conflict (code) do nothing",next.toString(),teacher,RefreshService.timestamp(now))==1)
                return new InviteCode(next.toString(),now);
        }
    }
    @Transactional(readOnly=true)
    public List<TeacherLink> list(UUID student) {
        auth.student(student);
        return db.query("select u.id,u.display_name,a.created_at from teacher_students a join users u on u.id=a.teacher_id where a.student_id=? order by a.created_at,u.id",
            (rs,n)->new TeacherLink(new TeacherSummary(rs.getObject(1,UUID.class),rs.getString(2)),rs.getTimestamp(3).toInstant()),student);
    }
    @Transactional
    public TeacherLink join(UUID student,String input) {
        auth.student(student); throttle.join(student);
        String code=input.toUpperCase(Locale.ROOT).replaceAll("[\\s-]","");
        // FOR SHARE linearizes join against rotation without serializing joins by other students.
        var teachers=db.query("select teacher_id from teacher_invite_codes where code=? and revoked_at is null for share",(rs,n)->rs.getObject(1,UUID.class),code);
        if(teachers.isEmpty()) throw fail(NOT_FOUND,"INVITE_CODE_INVALID","유효하지 않은 초대 코드입니다.");
        UUID teacher=teachers.getFirst();
        db.update("insert into teacher_students(teacher_id,student_id,created_at) values (?,?,?) on conflict do nothing",teacher,student,RefreshService.timestamp(clock.instant()));
        return db.queryForObject("select u.id,u.display_name,a.created_at from teacher_students a join users u on u.id=a.teacher_id where a.teacher_id=? and a.student_id=?",
            (rs,n)->new TeacherLink(new TeacherSummary(rs.getObject(1,UUID.class),rs.getString(2)),rs.getTimestamp(3).toInstant()),teacher,student);
    }
}
