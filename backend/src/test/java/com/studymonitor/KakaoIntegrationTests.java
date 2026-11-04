package com.studymonitor;

import com.sun.net.httpserver.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.*;
import org.springframework.jdbc.core.JdbcTemplate;
import jakarta.servlet.http.Cookie;
import tools.jackson.databind.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static com.studymonitor.Api.*;

/** Only the Kakao provider is mocked, on an ephemeral loopback port. The database is Testcontainers. */
@SpringBootTest(properties={"app.auth.cookie-secure=true","app.kakao.rest-api-key=test-client-placeholder",
    "app.kakao.client-secret=test-secret-placeholder","app.kakao.redirect-uri=http://localhost/callback",
    "app.auth.frontend-base-url=https://study.example.test"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class,BackendIntegrationTests.TimeConfiguration.class})
class KakaoIntegrationTests {
    static final HttpServer PROVIDER;
    static final ExecutorService EXECUTOR=Executors.newVirtualThreadPerTaskExecutor();
    static final AtomicReference<String> tokenBody=new AtomicReference<>(),profileAuthorization=new AtomicReference<>();
    static final AtomicInteger tokenStatus=new AtomicInteger(200),profileStatus=new AtomicInteger(200),calls=new AtomicInteger();
    static final AtomicLong delay=new AtomicLong();
    static final AtomicReference<String> profileBody=new AtomicReference<>(),tokenResponse=new AtomicReference<>();
    static {
        try {
            PROVIDER=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0); PROVIDER.setExecutor(EXECUTOR);
            PROVIDER.createContext("/oauth/token",exchange -> {
                calls.incrementAndGet(); tokenBody.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
                try { Thread.sleep(delay.get()); } catch(InterruptedException e) { Thread.currentThread().interrupt(); }
                respond(exchange,tokenStatus.get(),tokenResponse.get());
            });
            PROVIDER.createContext("/v2/user/me",exchange -> {
                profileAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                respond(exchange,profileStatus.get(),profileBody.get());
            });
            PROVIDER.start();
        } catch(IOException e) { throw new ExceptionInInitializerError(e); }
    }
    static void respond(HttpExchange exchange,int status,String body) throws IOException {
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8); exchange.getResponseHeaders().set("Content-Type","application/json");
        try { exchange.sendResponseHeaders(status,bytes.length); exchange.getResponseBody().write(bytes); } finally { exchange.close(); }
    }
    @DynamicPropertySource static void providerUrls(DynamicPropertyRegistry properties) {
        String url="http://127.0.0.1:"+PROVIDER.getAddress().getPort();
        properties.add("app.kakao.auth-base-url",()->url); properties.add("app.kakao.api-base-url",()->url);
    }
    @AfterAll static void stopProvider() { PROVIDER.stop(0); EXECUTOR.close(); }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired BackendIntegrationTests.MutableClock clock;
    @Autowired AuthThrottle throttle;
    @Autowired KakaoService kakao;
    @Autowired AuthService auth;
    @Autowired AccountService accounts;
    @Autowired RefreshService refresh;
    @Autowired Store store;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @BeforeEach void reset() {
        throttle.clear(); clock.set("2026-11-04T00:00:00Z"); db.execute("truncate users cascade");
        tokenStatus.set(200); profileStatus.set(200); delay.set(0); calls.set(0); tokenBody.set(null); profileAuthorization.set(null);
        profileBody.set("{\"id\":123456,\"kakao_account\":{\"profile\":{\"nickname\":\"카카오 이름\",\"profile_image_url\":\"https://unused.invalid/image\"},\"email\":\"unused@example.invalid\"}}");
        tokenResponse.set("{\"access_token\":\"mock-provider-access-token\",\"refresh_token\":\"mock-provider-refresh-token\"}");
    }
    JsonNode body(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
    Cookie cookie(MvcResult result,String name) { Cookie cookie=result.getResponse().getCookie(name); assertThat(cookie).isNotNull(); return cookie; }
    MvcResult start() throws Exception { return mvc.perform(get("/api/v1/auth/kakao/start")).andExpect(status().isFound()).andReturn(); }
    ResultActions callback(Cookie state) throws Exception {
        return mvc.perform(get("/api/v1/auth/kakao/callback").param("state",state.getValue()).param("code","mock-code").cookie(state));
    }
    Cookie newTicket() throws Exception {
        return cookie(callback(cookie(start(),"sm_oauth")).andExpect(status().isFound()).andExpect(header().string("Location","https://study.example.test/signup/kakao")).andReturn(),"sm_signup");
    }
    ResultActions complete(Cookie ticket,KakaoCompleteRequest request) throws Exception {
        return mvc.perform(post("/api/v1/auth/kakao/complete").cookie(ticket).contentType("application/json").content(json.writeValueAsString(request)));
    }
    KakaoCompleteRequest request(Role role) { return new KakaoCompleteRequest("  사용자가 정한 이름  ",role,new Agreements(true,true)); }
    @Test void providersStartStateCookieAuthorizeParametersAndRandomness() throws Exception {
        mvc.perform(get("/api/v1/auth/providers")).andExpect(status().isOk()).andExpect(jsonPath("$.password").value(true)).andExpect(jsonPath("$.kakao").value(true));
        var first=start(); Cookie state=cookie(first,"sm_oauth");
        assertThat(Base64.getUrlDecoder().decode(state.getValue())).hasSize(16);
        assertThat(state.isHttpOnly()).isTrue(); assertThat(state.getSecure()).isTrue(); assertThat(state.getPath()).isEqualTo("/api/v1/auth/kakao"); assertThat(state.getMaxAge()).isEqualTo(600);
        assertThat(first.getResponse().getHeader("Set-Cookie")).contains("SameSite=Lax");
        String location=first.getResponse().getHeader("Location");
        assertThat(location).startsWith("http://127.0.0.1:"+PROVIDER.getAddress().getPort()+"/oauth/authorize?");
        Map<String,String> query=parseForm(URI.create(location).getRawQuery());
        assertThat(query).containsEntry("response_type","code").containsEntry("client_id","test-client-placeholder")
            .containsEntry("redirect_uri","http://localhost/callback").containsEntry("state",state.getValue());
        assertThat(cookie(start(),"sm_oauth").getValue()).isNotEqualTo(state.getValue());
    }
    static Map<String,String> parseForm(String raw) {
        Map<String,String> result=new HashMap<>();
        for(String part:raw.split("&")) { var pair=part.split("=",2); result.put(URLDecoder.decode(pair[0],StandardCharsets.UTF_8),URLDecoder.decode(pair[1],StandardCharsets.UTF_8)); }
        return result;
    }
    @Test void stateMismatchMissingStateAndCancellationNeverCallProviderAndAlwaysClearState() throws Exception {
        var state=cookie(start(),"sm_oauth");
        var mismatch=mvc.perform(get("/api/v1/auth/kakao/callback").param("state","wrong").param("code","mock-code").cookie(state))
            .andExpect(status().isFound()).andExpect(header().string("Location","https://study.example.test/login?error=kakao_failed")).andReturn();
        assertThat(cookie(mismatch,"sm_oauth").getMaxAge()).isZero();
        mvc.perform(get("/api/v1/auth/kakao/callback").param("code","mock-code")).andExpect(status().isFound())
            .andExpect(header().string("Location","https://study.example.test/login?error=kakao_failed"));
        mvc.perform(get("/api/v1/auth/kakao/callback").param("state",state.getValue()).param("error","access_denied").cookie(state))
            .andExpect(status().isFound()).andExpect(header().string("Location","https://study.example.test/login?error=kakao_cancelled"));
        mvc.perform(get("/api/v1/auth/kakao/callback").param("state",state.getValue()).param("error","server_error").cookie(state))
            .andExpect(status().isFound()).andExpect(header().string("Location","https://study.example.test/login?error=kakao_failed"));
        assertThat(calls.get()).isZero();
    }
    @Test void provider500AndMalformedResponsesRedirectToFailure() throws Exception {
        for(int which=0;which<4;which++) {
            reset();
            if(which==0) tokenStatus.set(500);
            if(which==1) profileStatus.set(500);
            if(which==2) tokenResponse.set("{}");
            if(which==3) profileBody.set("{\"id\":\"not-a-number\"}");
            var result=callback(cookie(start(),"sm_oauth")).andExpect(status().isFound())
                .andExpect(header().string("Location","https://study.example.test/login?error=kakao_failed")).andReturn();
            assertThat(cookie(result,"sm_oauth").getMaxAge()).isZero();
            assertThat(result.getResponse().getCookie("sm_signup")).isNull(); assertThat(result.getResponse().getCookie("sm_rt")).isNull();
        }
    }
    @Test void exchangeTimesOutAfterFiveSeconds() throws Exception {
        delay.set(6200); long started=System.nanoTime();
        callback(cookie(start(),"sm_oauth")).andExpect(status().isFound()).andExpect(header().string("Location","https://study.example.test/login?error=kakao_failed"));
        assertThat(Duration.ofNanos(System.nanoTime()-started)).isBetween(Duration.ofSeconds(4),Duration.ofSeconds(6));
    }
    @Test void newUserTicketPendingCompleteAndExistingIdentityLogin() throws Exception {
        Cookie ticket=newTicket(); assertThat(ticket.getPath()).isEqualTo("/api/v1/auth/kakao"); assertThat(ticket.getMaxAge()).isEqualTo(600); assertThat(ticket.isHttpOnly()).isTrue(); assertThat(ticket.getSecure()).isTrue();
        assertThat(parseForm(tokenBody.get())).containsEntry("grant_type","authorization_code").containsEntry("client_id","test-client-placeholder")
            .containsEntry("redirect_uri","http://localhost/callback").containsEntry("code","mock-code").containsEntry("client_secret","test-secret-placeholder");
        assertThat(profileAuthorization.get()).isEqualTo("Bearer mock-provider-access-token");
        mvc.perform(get("/api/v1/auth/kakao/pending").cookie(ticket)).andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value("카카오 이름"));
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isZero();
        var result=complete(ticket,request(Role.TEACHER)).andExpect(status().isCreated()).andExpect(jsonPath("$.user.email").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.user.displayName").value("사용자가 정한 이름")).andExpect(jsonPath("$.user.role").value("TEACHER")).andReturn();
        assertThat(body(result).get("user").has("email")).isTrue();
        assertThat(cookie(result,"sm_signup").getMaxAge()).isZero(); assertThat(cookie(result,"sm_rt").getMaxAge()).isEqualTo(1209600);
        String id=body(result).get("user").get("id").asText();
        var stored=db.queryForMap("select * from users"); assertThat(stored.get("email")).isNull(); assertThat(stored.get("password_hash")).isNull();
        assertThat(stored.get("agreements_version")).isEqualTo("2026-11-04"); assertThat(stored.get("terms_agreed_at")).isNotNull();
        var identity=db.queryForMap("select * from user_identities"); assertThat(identity.get("provider_user_id")).isEqualTo("123456"); assertThat(identity.get("provider")).isEqualTo("KAKAO");
        var existing=callback(cookie(start(),"sm_oauth")).andExpect(status().isFound()).andExpect(header().string("Location","https://study.example.test/auth/kakao/done")).andReturn();
        assertThat(existing.getResponse().getCookie("sm_signup")).isNull(); assertThat(existing.getResponse().getHeader("Location")).doesNotContain("token","code=");
        mvc.perform(post("/api/v1/auth/refresh").cookie(cookie(existing,"sm_rt"))).andExpect(status().isOk()).andExpect(jsonPath("$.user.id").value(id));
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isEqualTo(1);
    }
    @Test void missingNicknameIsNullAndOnlyEnteredNameIsStored() throws Exception {
        profileBody.set("{\"id\":987654}"); Cookie ticket=newTicket();
        mvc.perform(get("/api/v1/auth/kakao/pending").cookie(ticket)).andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(org.hamcrest.Matchers.nullValue()));
        complete(ticket,request(Role.STUDENT)).andExpect(status().isCreated());
        assertThat(db.queryForObject("select display_name from users",String.class)).isEqualTo("사용자가 정한 이름");
    }
    @Test void completeIsIdempotentEvenWhenRoleOrNameChangesAndNoPasswordAccountLinking() throws Exception {
        accounts.signup(new SignupRequest("unused@example.invalid",AccountsIntegrationTests.PASSWORD,"password account",Role.STUDENT,new Agreements(true,true)));
        Cookie ticket=newTicket(); var first=complete(ticket,request(Role.STUDENT)).andExpect(status().isCreated()).andReturn();
        var second=complete(ticket,new KakaoCompleteRequest("changed",Role.TEACHER,new Agreements(true,true))).andExpect(status().isCreated()).andReturn();
        assertThat(body(second).get("user")).isEqualTo(body(first).get("user"));
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isEqualTo(2);
        assertThat(db.queryForObject("select count(*) from user_identities",Integer.class)).isEqualTo(1);
    }
    @Test void simultaneousCompleteCreatesOneIdentityAndOneAccount() throws Exception {
        Cookie ticket=newTicket(); String id=kakao.pending(ticket.getValue()).id();
        try(var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(() -> accounts.complete(id,request(Role.STUDENT)));
            var b=executor.submit(() -> accounts.complete(id,request(Role.STUDENT)));
            assertThat(a.get(10,TimeUnit.SECONDS).id).isEqualTo(b.get(10,TimeUnit.SECONDS).id);
        }
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("select count(*) from user_identities",Integer.class)).isEqualTo(1);
    }
    @Test void expiredTamperedWrongAudienceAndMissingTicketsRejected() throws Exception {
        mvc.perform(get("/api/v1/auth/kakao/pending")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/kakao/complete").contentType("application/json").content(json.writeValueAsString(request(Role.STUDENT)))).andExpect(status().isUnauthorized());
        Cookie ticket=newTicket();
        String raw=ticket.getValue(); Cookie tampered=new Cookie("sm_signup",raw.substring(0,raw.lastIndexOf('.')+1)+"invalid-signature");
        mvc.perform(get("/api/v1/auth/kakao/pending").cookie(tampered)).andExpect(status().isUnauthorized());
        var passwordUser=accounts.signup(new SignupRequest("valid@sample.test",AccountsIntegrationTests.PASSWORD,"name",Role.STUDENT,new Agreements(true,true)));
        mvc.perform(get("/api/v1/auth/kakao/pending").cookie(new Cookie("sm_signup",auth.tokens(passwordUser).accessToken()))).andExpect(status().isUnauthorized());
        clock.advance(600);
        mvc.perform(get("/api/v1/auth/kakao/pending").cookie(ticket)).andExpect(status().isUnauthorized());
        complete(ticket,request(Role.STUDENT)).andExpect(status().isUnauthorized());
    }
    @Test void ticketCannotAuthenticateProtectedApiAndCompleteValidatesNameAndAgreements() throws Exception {
        Cookie ticket=newTicket();
        mvc.perform(get("/api/v1/me").header("Authorization","Bearer "+ticket.getValue())).andExpect(status().isUnauthorized());
        complete(ticket,new KakaoCompleteRequest("\ninvalid",Role.STUDENT,new Agreements(true,true))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("displayName"));
        complete(ticket,new KakaoCompleteRequest("valid",Role.STUDENT,new Agreements(false,true))).andExpect(status().isBadRequest());
        assertThat(db.queryForObject("select count(*) from users",Integer.class)).isZero();
    }
    @Test void kakaoCredentialRoutesShareIpBudgetButPendingDoesNotSpendIt() throws Exception {
        for(int i=0;i<30;i++) start();
        mvc.perform(get("/api/v1/auth/kakao/start")).andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","60"));
        mvc.perform(get("/api/v1/auth/kakao/callback")).andExpect(status().isTooManyRequests());
        complete(new Cookie("sm_signup","invalid"),request(Role.STUDENT)).andExpect(status().isTooManyRequests());
        mvc.perform(get("/api/v1/auth/kakao/pending")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/providers")).andExpect(status().isOk());
    }
}
