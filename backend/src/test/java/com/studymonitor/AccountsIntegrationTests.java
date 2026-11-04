package com.studymonitor;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import jakarta.servlet.http.Cookie;
import org.springframework.mock.web.*;
import tools.jackson.databind.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static com.studymonitor.Api.*;

@SpringBootTest(properties={"app.auth.cookie-secure=false","app.kakao.rest-api-key=","app.kakao.redirect-uri="})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class,BackendIntegrationTests.TimeConfiguration.class})
class AccountsIntegrationTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired BackendIntegrationTests.MutableClock clock;
    @Autowired AuthThrottle throttle;
    @Autowired AccountService accounts;
    @Autowired Store store;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired AuthService auth;
    @Autowired RefreshService refresh;
    @Autowired InviteService invites;
    @Autowired JwtDecoder decoder;
    @Autowired SessionService sessions;
    @Autowired ReportService reports;
    @Autowired SseHub streams;
    @Autowired AppConfig.Auth settings;
    static final String PASSWORD="NobleStudy82!";
    static final Agreements AGREED=new Agreements(true,true);
    @BeforeEach void reset() {
        streams.close(); throttle.clear(); clock.set("2026-11-04T00:00:00Z");
        db.execute("truncate users cascade");
    }
    Domain.Account account(String email,Role role) { return accounts.signup(new SignupRequest(email,PASSWORD," 이름 ",role,AGREED)); }
    String bearer(Domain.Account user) { return auth.tokens(user).accessToken(); }
    Object signup(String email,String password,String name) { return Map.of("email",email,"password",password,"displayName",name,"role","STUDENT","agreements",Map.of("terms",true,"privacy",true)); }
    ResultActions postBody(String path,Object value) throws Exception {
        return mvc.perform(post(path).contentType("application/json").content(json.writeValueAsString(value)));
    }
    JsonNode body(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
    Cookie cookie(MvcResult result,String name) {
        Cookie cookie=result.getResponse().getCookie(name); assertThat(cookie).isNotNull(); return cookie;
    }
    MvcResult login(String email) throws Exception { return postBody("/api/v1/auth/login",new LoginRequest(email,PASSWORD)).andExpect(status().isOk()).andReturn(); }
    ResultActions rotate(Cookie cookie) throws Exception { return mvc.perform(post("/api/v1/auth/refresh").cookie(cookie)); }
    @Test void signupPersistsAgreementsAndLowercaseEmailAndIssuesTokens() throws Exception {
        var result=postBody("/api/v1/auth/signup",signup("NEW@sample.test",PASSWORD,"  새 이름  ")).andExpect(status().isCreated())
            .andExpect(jsonPath("$.user.email").value("new@sample.test")).andExpect(jsonPath("$.user.displayName").value("새 이름")).andReturn();
        var claims=decoder.decode(body(result).get("accessToken").asText());
        assertThat(claims.getId()).isNotBlank(); assertThat(claims.getClaimAsString("role")).isEqualTo("STUDENT");
        var stored=db.queryForMap("select * from users");
        assertThat(stored.get("agreements_version")).isEqualTo("2026-11-04");
        assertThat(stored.get("terms_agreed_at")).isEqualTo(java.sql.Timestamp.from(clock.instant()));
        assertThat(stored.get("privacy_agreed_at")).isEqualTo(stored.get("terms_agreed_at"));
        assertThat(stored.get("password_hash").toString()).startsWith("$2").isNotEqualTo(PASSWORD);
        assertRefreshCookie(result,false,1209600);
        String raw=cookie(result,"sm_rt").getValue();
        assertThat(Base64.getUrlDecoder().decode(raw)).hasSize(32);
        assertThat(db.queryForObject("select token_hash from refresh_tokens",String.class)).isEqualTo(RefreshService.hash(raw));
    }
    void assertRefreshCookie(MvcResult result,boolean secure,int age) {
        Cookie c=cookie(result,"sm_rt"); assertThat(c.isHttpOnly()).isTrue(); assertThat(c.getSecure()).isEqualTo(secure);
        assertThat(c.getPath()).isEqualTo("/api/v1/auth"); assertThat(c.getMaxAge()).isEqualTo(age);
        assertThat(result.getResponse().getHeaders("Set-Cookie").toString()).contains("SameSite=Lax");
    }
    @Test void teacherSignupIsAllowedAndDuplicateEmailIs409() throws Exception {
        var request=new SignupRequest("teacher@sample.test",PASSWORD,"교사",Role.TEACHER,AGREED);
        postBody("/api/v1/auth/signup",request).andExpect(status().isCreated()).andExpect(jsonPath("$.user.role").value("TEACHER"));
        postBody("/api/v1/auth/signup",new SignupRequest("TEACHER@sample.test",PASSWORD,"다른 이름",Role.STUDENT,AGREED))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isEqualTo(1);
    }
    @ParameterizedTest @ValueSource(strings={"short1","onlyletters","1234567890","abc12345","PASSWORD1","qwer1234","1q2w3e4r"})
    void passwordPolicyRejectsEveryRuleWithKoreanPasswordField(String password) throws Exception {
        postBody("/api/v1/auth/signup",signup("abc@sample.test",password,"이름")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED")).andExpect(jsonPath("$.errors[0].field").value("password"))
            .andExpect(jsonPath("$.errors[0].message").value(org.hamcrest.Matchers.matchesPattern(".*[가-힣].*")));
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isZero();
    }
    @Test void passwordCharacterAndUtf8ByteBoundaries() throws Exception {
        for(String password:List.of("a".repeat(64)+"1","가".repeat(24)+"1","😀".repeat(18)+"a1"))
            postBody("/api/v1/auth/signup",signup("abc@sample.test",password,"이름")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("password"));
        for(String password:List.of("v".repeat(63)+"1","가".repeat(23)+"ab1","testab12","abcde678")) {
            String email="xy@"+UUID.randomUUID()+".test";
            postBody("/api/v1/auth/signup",signup(email,password,"이름")).andExpect(status().isCreated());
        }
    }
    @Test void passwordEmailLocalPartIsCaseInsensitiveAndShortLocalsAllowed() throws Exception {
        postBody("/api/v1/auth/signup",signup("Abc@sample.test","xABCdef123","이름")).andExpect(status().isBadRequest());
        postBody("/api/v1/auth/signup",signup("ab@sample.test","xABcdef123","이름")).andExpect(status().isCreated());
    }
    @Test void nullPasswordAndMalformedEmailAreKoreanValidationErrors() throws Exception {
        var request=new SignupRequest("valid@sample.test",null,"name",Role.STUDENT,AGREED);
        postBody("/api/v1/auth/signup",request).andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("password"));
        postBody("/api/v1/auth/signup",signup("bad",PASSWORD,"name")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors[0].field").value("email")).andExpect(jsonPath("$.errors[0].message").value("올바른 이메일을 입력해 주세요."));
    }
    @ParameterizedTest @ValueSource(strings={"", "    ", "bad\nname", "bad\u007fname", "0123456789012345678901234567890"})
    void displayNameRules(String name) throws Exception {
        postBody("/api/v1/auth/signup",signup("valid@sample.test",PASSWORD,name)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("displayName"));
    }
    @Test void displayNameAllowsThirtyUnicodeCharactersAfterTrim() throws Exception {
        postBody("/api/v1/auth/signup",signup("valid@sample.test",PASSWORD,"  "+"😀".repeat(30)+"  ")).andExpect(status().isCreated());
    }
    @ParameterizedTest @CsvSource({"false,true","true,false","false,false"})
    void bothAgreementsRequired(boolean terms,boolean privacy) throws Exception {
        postBody("/api/v1/auth/signup",new SignupRequest("valid@sample.test",PASSWORD,"name",Role.STUDENT,new Agreements(terms,privacy)))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
    @Test void missingAgreementsAndRoleFail() throws Exception {
        postBody("/api/v1/auth/signup",new SignupRequest("valid@sample.test",PASSWORD,"name",null,null)).andExpect(status().isBadRequest());
        postBody("/api/v1/auth/signup",new SignupRequest("valid@sample.test",PASSWORD,"name",Role.STUDENT,new Agreements(null,true))).andExpect(status().isBadRequest());
    }
    @Test void loginIssuesNewCookieAndUniqueJtiEveryTime() throws Exception {
        account("valid@sample.test",Role.STUDENT);
        var first=login("valid@sample.test"); var second=login("valid@sample.test");
        assertRefreshCookie(first,false,1209600);
        assertThat(cookie(first,"sm_rt").getValue()).isNotEqualTo(cookie(second,"sm_rt").getValue());
        assertThat(decoder.decode(body(first).get("accessToken").asText()).getId()).isNotEqualTo(decoder.decode(body(second).get("accessToken").asText()).getId());
    }
    @ParameterizedTest @ValueSource(booleans={true,false})
    void knownAndUnknownEmailLockForFifteenMinutes(boolean known) throws Exception {
        if(known) account("valid@sample.test",Role.STUDENT);
        for(int i=0;i<4;i++) postBody("/api/v1/auth/login",new LoginRequest("VALID@sample.test","wrong"))
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("BAD_CREDENTIALS"));
        postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test","wrong")).andExpect(status().isTooManyRequests())
            .andExpect(header().string("Retry-After","900")).andExpect(jsonPath("$.code").value("TOO_MANY_ATTEMPTS"));
        clock.advance(1);
        postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test",PASSWORD)).andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","899"));
        clock.advance(899);
        postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test",PASSWORD)).andExpect(known?status().isOk():status().isUnauthorized());
    }
    @Test void successfulLoginResetsConsecutiveFailures() throws Exception {
        account("valid@sample.test",Role.STUDENT);
        for(int n=0;n<2;n++) {
            for(int i=0;i<4;i++) postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test","wrong")).andExpect(status().isUnauthorized());
            login("valid@sample.test");
        }
    }
    @Test void credentialIpSlidingLimitAndRefreshSeparateLimit() throws Exception {
        for(int i=0;i<30;i++) postBody("/api/v1/auth/login",new LoginRequest("n"+i+"@sample.test","wrong")).andExpect(status().isUnauthorized());
        postBody("/api/v1/auth/signup",signup("valid@sample.test",PASSWORD,"이름")).andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","60"));
        for(int i=0;i<120;i++) mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","60"));
        // Providers, pending and logout do not spend either IP budget.
        mvc.perform(get("/api/v1/auth/providers")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/logout")).andExpect(status().isNoContent());
        clock.advance(60);
        postBody("/api/v1/auth/signup",signup("valid@sample.test",PASSWORD,"이름")).andExpect(status().isCreated());
        mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isUnauthorized());
    }
    @Test void forwardedHeaderIgnoredByDefaultAndRemoteIpsAreIndependent() throws Exception {
        var req=new MockHttpServletRequest(); req.setRemoteAddr("10.0.0.7"); req.addHeader("X-Forwarded-For","1.1.1.1, 2.2.2.2");
        assertThat(throttle.clientIp(req)).isEqualTo("10.0.0.7");
        var trusted=new AuthThrottle(clock,new AppConfig.Auth(settings.refreshTtl(),settings.refreshReuseGrace(),false,"version",true,2,3,"http://localhost:3000"));
        assertThat(trusted.clientIp(req)).isEqualTo("2.2.2.2");
        for(int i=0;i<2;i++) trusted.credential(req);
        assertThatThrownBy(() -> trusted.credential(req)).isInstanceOf(Problems.Failure.class).extracting("retryAfter").isEqualTo(60L);
        for(int i=0;i<3;i++) trusted.refresh(req);
        assertThatThrownBy(() -> trusted.refresh(req)).isInstanceOf(Problems.Failure.class);
        req.removeHeader("X-Forwarded-For"); req.addHeader("X-Forwarded-For","1.1.1.1, 3.3.3.3"); trusted.credential(req); trusted.refresh(req);
    }
    @Test void cookieSecureConfigurationAndProductionDefault() {
        assertThat(new AuthCookies(new AppConfig.Auth(Duration.ofDays(2),Duration.ofSeconds(30),true,"v",false,30,120,"http://localhost:3000"))).isNotNull();
        var response=new MockHttpServletResponse();
        new AuthCookies(new AppConfig.Auth(Duration.ofDays(2),Duration.ofSeconds(30),true,"v",false,30,120,"http://localhost:3000")).refresh(response,"fake");
        assertThat(response.getHeader("Set-Cookie")).contains("Secure","HttpOnly","SameSite=Lax","Max-Age=172800","Path=/api/v1/auth");
    }
    @Test void corsPreflightAllowsCredentialsOnlyForExplicitOrigin() throws Exception {
        mvc.perform(options("/api/v1/auth/refresh").header("Origin","http://localhost:3000").header("Access-Control-Request-Method","POST"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Credentials","true"))
            .andExpect(header().string("Access-Control-Allow-Origin","http://localhost:3000"));
        mvc.perform(options("/api/v1/auth/refresh").header("Origin","https://untrusted.example").header("Access-Control-Request-Method","POST"))
            .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }
    @Test void crossOrigin429ExposesRetryAfterToTheBrowser() throws Exception {
        for(int i=0;i<30;i++) postBody("/api/v1/auth/login",new LoginRequest("n"+i+"@sample.test","wrong")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login").header("Origin","http://localhost:3000").contentType("application/json")
                .content(json.writeValueAsString(new LoginRequest("valid@sample.test","wrong"))))
            .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","60"))
            .andExpect(header().string("Access-Control-Allow-Origin","http://localhost:3000"))
            .andExpect(header().string("Access-Control-Allow-Credentials","true"))
            .andExpect(header().string("Access-Control-Expose-Headers",org.hamcrest.Matchers.containsString("Retry-After")));
    }
    @Test void refreshRotationGraceOnceAndReuseRevokesWholeFamily() throws Exception {
        var user=account("valid@sample.test",Role.STUDENT); var initial=login(user.email); Cookie original=cookie(initial,"sm_rt");
        var first=rotate(original).andExpect(status().isOk()).andReturn();
        var grace=rotate(original).andExpect(status().isOk()).andReturn();
        rotate(original).andExpect(status().isUnauthorized()); // grace is single-use even at the same instant
        rotate(cookie(first,"sm_rt")).andExpect(status().isOk());
        rotate(cookie(grace,"sm_rt")).andExpect(status().isOk());
        clock.advance(30);
        var rejected=rotate(original).andExpect(status().isUnauthorized()).andReturn(); assertRefreshCookie(rejected,false,0);
        rotate(cookie(first,"sm_rt")).andExpect(status().isUnauthorized()); rotate(cookie(grace,"sm_rt")).andExpect(status().isUnauthorized());
        assertThat(db.queryForObject("select count(*) from refresh_tokens where revoked_at is null",Integer.class)).isZero();
    }
    @Test void refreshUnknownMissingExpiredAlwaysClearsCookie() throws Exception {
        var missing=mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isUnauthorized()).andReturn(); assertRefreshCookie(missing,false,0);
        var unknown=rotate(new Cookie("sm_rt","unknown")).andExpect(status().isUnauthorized()).andReturn(); assertRefreshCookie(unknown,false,0);
        account("valid@sample.test",Role.STUDENT); Cookie original=cookie(login("valid@sample.test"),"sm_rt");
        clock.advance(14*86400);
        var expired=rotate(original).andExpect(status().isUnauthorized()).andReturn(); assertRefreshCookie(expired,false,0);
    }
    @Test void graceAtTwentyNineSecondsAndSeparateFamiliesSurviveReuse() throws Exception {
        var user=account("valid@sample.test",Role.STUDENT);
        Cookie original=cookie(login(user.email),"sm_rt"),independent=cookie(login(user.email),"sm_rt");
        rotate(original).andExpect(status().isOk()); clock.advance(29); rotate(original).andExpect(status().isOk());
        clock.advance(1); rotate(original).andExpect(status().isUnauthorized()); rotate(independent).andExpect(status().isOk());
    }
    @Test void logoutRevokesFamilyWithoutGraceAndIsAlways204() throws Exception {
        var user=account("valid@sample.test",Role.STUDENT); Cookie original=cookie(login(user.email),"sm_rt");
        Cookie current=cookie(rotate(original).andExpect(status().isOk()).andReturn(),"sm_rt");
        var logout=mvc.perform(post("/api/v1/auth/logout").cookie(original)).andExpect(status().isNoContent()).andReturn(); assertRefreshCookie(logout,false,0);
        rotate(original).andExpect(status().isUnauthorized()); rotate(current).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/logout")).andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/logout").cookie(new Cookie("sm_rt","unknown"))).andExpect(status().isNoContent());
    }
    @Test void simultaneousTabRefreshesBothSucceedAndGracePersistsAcrossServiceInstances() throws Exception {
        var user=account("valid@sample.test",Role.STUDENT); String original=refresh.issue(user.id,null).token();
        try(var executor=Executors.newFixedThreadPool(2)) {
            var start=new CountDownLatch(1);
            var a=executor.submit(() -> { start.await(); return refresh.rotate(original,null); });
            var b=executor.submit(() -> { start.await(); return refresh.rotate(original,null); }); start.countDown();
            var first=a.get(10,TimeUnit.SECONDS); var second=b.get(10,TimeUnit.SECONDS);
            assertThat(first.token()).isNotEqualTo(second.token());
            var anotherInstance=new RefreshService(db,store,clock,auth,settings);
            assertThatThrownBy(() -> new org.springframework.transaction.support.TransactionTemplate(transactions)
                .execute(tx -> anotherInstance.rotate(original,null))).isInstanceOf(Problems.Failure.class);
            assertThat(refresh.rotate(first.token(),null)).isNotNull(); assertThat(refresh.rotate(second.token(),null)).isNotNull();
        }
    }
    @Test void expiredRotatedTokenStillRevokesAnOtherwiseLiveDescendant() throws Exception {
        var user=account("valid@sample.test",Role.STUDENT); Cookie original=cookie(login(user.email),"sm_rt");
        clock.advance(60); Cookie child=cookie(rotate(original).andExpect(status().isOk()).andReturn(),"sm_rt");
        clock.advance(14*86400-60);
        rotate(original).andExpect(status().isUnauthorized());
        rotate(child).andExpect(status().isUnauthorized());
        assertThat(db.queryForObject("select count(*) from refresh_tokens where revoked_at is null",Integer.class)).isZero();
    }
    @Test void cookieAuthIgnoresUnrelatedInvalidBearerAndLogoutStillReturns204() throws Exception {
        var result=mvc.perform(post("/api/v1/auth/refresh").header("Authorization","Bearer invalid"))
            .andExpect(status().isUnauthorized()).andReturn(); assertRefreshCookie(result,false,0);
        var user=account("valid@sample.test",Role.STUDENT); Cookie original=cookie(login(user.email),"sm_rt");
        var rotated=mvc.perform(post("/api/v1/auth/refresh").cookie(original).header("Authorization","Bearer invalid"))
            .andExpect(status().isOk()).andReturn();
        mvc.perform(post("/api/v1/auth/logout").cookie(cookie(rotated,"sm_rt")).header("Authorization","Bearer invalid"))
            .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/auth/kakao/start").header("Authorization","Bearer invalid"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("PROVIDER_DISABLED"));
    }
    @Test void consecutiveEmailFailuresPersistUntilSuccessOrLockExpiry() throws Exception {
        account("valid@sample.test",Role.STUDENT);
        for(int i=0;i<4;i++) {
            postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test","wrong")).andExpect(status().isUnauthorized());
            clock.advance(3600);
        }
        postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test","wrong")).andExpect(status().isTooManyRequests());
    }
    @Test void longLoginPasswordProducesBadCredentialsInsteadOfServerError() throws Exception {
        account("valid@sample.test",Role.STUDENT);
        postBody("/api/v1/auth/login",new LoginRequest("valid@sample.test","a".repeat(128)))
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("BAD_CREDENTIALS"));
    }
    @Test void providersAndAllKakaoEndpointsDisabledWithoutConfiguration() throws Exception {
        mvc.perform(get("/api/v1/auth/providers")).andExpect(status().isOk()).andExpect(jsonPath("$.password").value(true)).andExpect(jsonPath("$.kakao").value(false));
        for(String path:List.of("start","callback","pending")) mvc.perform(get("/api/v1/auth/kakao/"+path)).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("PROVIDER_DISABLED"));
        postBody("/api/v1/auth/kakao/complete",new KakaoCompleteRequest("name",Role.STUDENT,AGREED)).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("PROVIDER_DISABLED"));
    }
    @Test void inviteCreateRotateNormalizeJoinIdempotentlyAndListSeveralTeachers() throws Exception {
        var teacher=account("teacher@sample.test",Role.TEACHER); var teacher2=account("second@sample.test",Role.TEACHER); var student=account("pupil@sample.test",Role.STUDENT);
        var code=invites.code(teacher.id,false); assertThat(code.code()).matches("[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}");
        assertThat(invites.code(teacher.id,false)).isEqualTo(code);
        String normalized=" "+code.code().substring(0,4).toLowerCase()+"- "+code.code().substring(4).toLowerCase()+" ";
        var first=invites.join(student.id,normalized); clock.advance(1);
        assertThat(invites.join(student.id,code.code())).isEqualTo(first);
        var second=invites.join(student.id,invites.code(teacher2.id,false).code());
        assertThat(invites.list(student.id)).containsExactly(first,second);
        var rotated=invites.code(teacher.id,true); assertThat(rotated.code()).isNotEqualTo(code.code());
        assertThat(invites.list(student.id)).contains(first);
        assertThatThrownBy(() -> invites.join(student.id,code.code())).isInstanceOf(Problems.Failure.class).extracting("code").isEqualTo("INVITE_CODE_INVALID");
        assertThat(invites.join(student.id,rotated.code())).isEqualTo(first);
        assertThat(db.queryForObject("select count(*) from teacher_invite_codes where teacher_id=? and revoked_at is null",Integer.class,teacher.id)).isEqualTo(1);
        assertThat(db.queryForObject("select count(*) from teacher_invite_codes where teacher_id=?",Integer.class,teacher.id)).isEqualTo(2);
    }
    @Test void inviteHttpShapesRoleChecksInvalidCodeAndJoinThrottle() throws Exception {
        var teacher=account("teacher@sample.test",Role.TEACHER); var student=account("pupil@sample.test",Role.STUDENT);
        String teacherToken=bearer(teacher),studentToken=bearer(student);
        var code=mvc.perform(get("/api/v1/teacher/invite-code").header("Authorization","Bearer "+teacherToken)).andExpect(status().isOk()).andExpect(jsonPath("$.createdAt").exists()).andReturn();
        var result=mvc.perform(post("/api/v1/me/teachers").header("Authorization","Bearer "+studentToken).contentType("application/json").content(json.writeValueAsString(new JoinTeacherRequest(body(code).get("code").asText()))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.teacher.id").value(teacher.id.toString())).andExpect(jsonPath("$.teacher.displayName").value("이름")).andExpect(jsonPath("$.linkedAt").exists()).andReturn();
        mvc.perform(get("/api/v1/me/teachers").header("Authorization","Bearer "+studentToken)).andExpect(status().isOk()).andExpect(jsonPath("$[0]").value(json.treeToValue(body(result),Map.class)));
        mvc.perform(post("/api/v1/teacher/invite-code/rotate").header("Authorization","Bearer "+teacherToken)).andExpect(status().isOk());
        for(String path:List.of("/api/v1/teacher/invite-code","/api/v1/teacher/invite-code/rotate"))
            mvc.perform((path.endsWith("rotate")?post(path):get(path)).header("Authorization","Bearer "+studentToken)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/me/teachers").header("Authorization","Bearer "+teacherToken)).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/me/teachers").header("Authorization","Bearer "+teacherToken).contentType("application/json").content("{\"inviteCode\":\"INVALID\"}")).andExpect(status().isForbidden());
        for(int i=0;i<9;i++) mvc.perform(post("/api/v1/me/teachers").header("Authorization","Bearer "+studentToken).contentType("application/json").content("{\"inviteCode\":\"INVALID\"}"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("INVITE_CODE_INVALID"));
        mvc.perform(post("/api/v1/me/teachers").header("Authorization","Bearer "+studentToken).contentType("application/json").content("{\"inviteCode\":\"INVALID\"}"))
            .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","600"));
        clock.advance(600);
        mvc.perform(post("/api/v1/me/teachers").header("Authorization","Bearer "+studentToken).contentType("application/json").content("{\"inviteCode\":\"INVALID\"}")).andExpect(status().isNotFound());
    }
    @Test void teacherOverviewAndAlreadyOpenSseIncludeLateLinkedStudent() {
        var teacher=account("teacher@sample.test",Role.TEACHER); var student=account("pupil@sample.test",Role.STUDENT);
        var emitter=new BackendIntegrationTests.RecordingEmitter(); streams.register(teacher.id,emitter);
        var session=sessions.start(student.id,new StartRequest(clock.instant(),null));
        assertThat(emitter.events()).isEmpty(); assertThat(reports.students(teacher.id)).isEmpty();
        invites.join(student.id,invites.code(teacher.id,false).code());
        assertThat(reports.students(teacher.id)).extracting(e -> e.student().id()).containsExactly(student.id);
        clock.advance(1);
        sessions.transition(student.id,session.id(),new TransitionRequest(UUID.randomUUID(),1L,State.FOCUS_ESTIMATED,Reason.SEATED_CONFIRMED,clock.instant(),null,null));
        assertThat(emitter.events()).singleElement().satisfies(e -> assertThat(e.studentId()).isEqualTo(student.id));
    }
    @Test void concurrentInviteCreationAndJoinsKeepOneCodeAndOneLink() throws Exception {
        var teacher=account("teacher@sample.test",Role.TEACHER); var student=account("pupil@sample.test",Role.STUDENT);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(() -> invites.code(teacher.id,false)); var b=executor.submit(() -> invites.code(teacher.id,false));
            var code=a.get(10,TimeUnit.SECONDS); assertThat(b.get(10,TimeUnit.SECONDS)).isEqualTo(code);
            var c=executor.submit(() -> invites.join(student.id,code.code())); var d=executor.submit(() -> invites.join(student.id,code.code()));
            assertThat(c.get(10,TimeUnit.SECONDS)).isEqualTo(d.get(10,TimeUnit.SECONDS));
            assertThat(invites.list(student.id)).hasSize(1);
        }
    }
}
