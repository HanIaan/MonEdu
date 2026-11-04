package com.studymonitor;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;
import org.springframework.web.servlet.HandlerInterceptor;
import jakarta.servlet.http.*;
import java.util.Set;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Configuration
public class AuthWebConfig implements WebMvcConfigurer {
    private final AuthThrottle throttle;
    private final AppConfig.Kakao kakao;
    public AuthWebConfig(AuthThrottle throttle,AppConfig.Kakao kakao) { this.throttle=throttle; this.kakao=kakao; }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            private final Set<String> credentials=Set.of("POST /api/v1/auth/signup","POST /api/v1/auth/login",
                "GET /api/v1/auth/kakao/start","GET /api/v1/auth/kakao/callback","POST /api/v1/auth/kakao/complete");
            @Override public boolean preHandle(HttpServletRequest req,HttpServletResponse res,Object handler) {
                if(req.getMethod().equals("OPTIONS")) return true;
                String path=req.getRequestURI();
                if(path.startsWith("/api/v1/auth/kakao/") && !kakao.enabled())
                    throw fail(NOT_FOUND,"PROVIDER_DISABLED","카카오 로그인이 설정되지 않았습니다.");
                String key=req.getMethod()+" "+path;
                if(credentials.contains(key)) throttle.credential(req);
                else if(key.equals("POST /api/v1/auth/refresh")) throttle.refresh(req);
                return true;
            }
        }).addPathPatterns("/api/v1/auth/**");
    }
}
