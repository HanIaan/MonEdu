package com.studymonitor;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.time.Duration;
import static com.studymonitor.Api.*;
import static com.studymonitor.AuthCookies.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService auth; private final AccountService accounts; private final RefreshService refresh;
    private final AuthCookies cookies; private final KakaoService kakao; private final AppConfig.Kakao config;
    public AuthController(AuthService auth,AccountService accounts,RefreshService refresh,AuthCookies cookies,KakaoService kakao,AppConfig.Kakao config) {
        this.auth=auth; this.accounts=accounts; this.refresh=refresh; this.cookies=cookies; this.kakao=kakao; this.config=config;
    }
    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request,HttpServletRequest http,HttpServletResponse response) {
        var login=auth.login(request); var issued=refresh.issue(login.user().id(),http.getHeader("User-Agent"));
        cookies.refresh(response,issued.token()); return issued.login();
    }
    @PostMapping("/signup") @ResponseStatus(HttpStatus.CREATED)
    public LoginResponse signup(@Valid @RequestBody SignupRequest request,HttpServletRequest http,HttpServletResponse response) {
        var account=accounts.signup(request); var issued=refresh.issue(account.id,http.getHeader("User-Agent"));
        cookies.refresh(response,issued.token()); return issued.login();
    }
    @PostMapping("/refresh")
    public LoginResponse refresh(@CookieValue(name="sm_rt",required=false) String raw,HttpServletRequest http,HttpServletResponse response) {
        try {
            var issued=refresh.rotate(raw,http.getHeader("User-Agent")); cookies.refresh(response,issued.token()); return issued.login();
        } catch(Problems.Failure failure) {
            if(failure.status==HttpStatus.UNAUTHORIZED) cookies.clear(response,"sm_rt",AUTH_PATH);
            throw failure;
        }
    }
    @PostMapping("/logout") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@CookieValue(name="sm_rt",required=false) String raw,HttpServletResponse response) {
        refresh.logout(raw); cookies.clear(response,"sm_rt",AUTH_PATH);
    }
    @GetMapping("/providers") public AuthProviders providers() { return new AuthProviders(true,config.enabled()); }
    private void redirect(HttpServletResponse response,String location) {
        response.setStatus(302); response.setHeader("Location",location);
    }
    @GetMapping("/kakao/start")
    public void start(HttpServletResponse response) {
        kakao.enabled(); String state=kakao.state(); cookies.set(response,"sm_oauth",state,KAKAO_PATH,Duration.ofMinutes(10));
        redirect(response,kakao.authorize(state));
    }
    @GetMapping("/kakao/callback")
    public void callback(@RequestParam(required=false) String code,@RequestParam(required=false) String state,@RequestParam(required=false) String error,
                         @CookieValue(name="sm_oauth",required=false) String expected,HttpServletRequest http,HttpServletResponse response) {
        kakao.enabled(); cookies.clear(response,"sm_oauth",KAKAO_PATH);
        if(!kakao.stateMatches(expected,state)) { redirect(response,kakao.frontend("/login?error=kakao_failed")); return; }
        if("access_denied".equals(error)) { redirect(response,kakao.frontend("/login?error=kakao_cancelled")); return; }
        if(error!=null) { redirect(response,kakao.frontend("/login?error=kakao_failed")); return; }
        try {
            var profile=kakao.exchange(code); var account=accounts.identity(profile.id());
            if(account!=null) {
                var issued=refresh.issue(account.id,http.getHeader("User-Agent")); cookies.refresh(response,issued.token());
                redirect(response,kakao.frontend("/auth/kakao/done"));
            } else {
                cookies.set(response,"sm_signup",kakao.ticket(profile),KAKAO_PATH,Duration.ofMinutes(10));
                redirect(response,kakao.frontend("/signup/kakao"));
            }
        } catch(InterruptedException interrupted) {
            Thread.currentThread().interrupt(); redirect(response,kakao.frontend("/login?error=kakao_failed"));
        } catch(Exception failure) {
            // Do not log exception bodies: provider errors may contain credentials or tokens.
            redirect(response,kakao.frontend("/login?error=kakao_failed"));
        }
    }
    @GetMapping("/kakao/pending")
    public KakaoPending pending(@CookieValue(name="sm_signup",required=false) String ticket) { return new KakaoPending(kakao.pending(ticket).nickname()); }
    @PostMapping("/kakao/complete") @ResponseStatus(HttpStatus.CREATED)
    public LoginResponse complete(@CookieValue(name="sm_signup",required=false) String ticket,@Valid @RequestBody KakaoCompleteRequest request,
                                   HttpServletRequest http,HttpServletResponse response) {
        var profile=kakao.pending(ticket); var account=accounts.complete(profile.id(),request);
        var issued=refresh.issue(account.id,http.getHeader("User-Agent"));
        cookies.clear(response,"sm_signup",KAKAO_PATH); cookies.refresh(response,issued.token()); return issued.login();
    }
}
