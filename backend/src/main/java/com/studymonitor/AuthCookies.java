package com.studymonitor;

import org.springframework.stereotype.Component;
import org.springframework.http.ResponseCookie;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;

@Component
public class AuthCookies {
    public static final String AUTH_PATH="/api/v1/auth", KAKAO_PATH=AUTH_PATH+"/kakao";
    private final AppConfig.Auth settings;
    public AuthCookies(AppConfig.Auth settings) { this.settings=settings; }
    public void set(HttpServletResponse response,String name,String value,String path,Duration ttl) {
        response.addHeader("Set-Cookie",ResponseCookie.from(name,value).httpOnly(true).secure(settings.cookieSecure())
            .sameSite("Lax").path(path).maxAge(ttl).build().toString());
    }
    public void refresh(HttpServletResponse response,String raw) { set(response,"sm_rt",raw,AUTH_PATH,settings.refreshTtl()); }
    public void clear(HttpServletResponse response,String name,String path) { set(response,name,"",path,Duration.ZERO); }
}
