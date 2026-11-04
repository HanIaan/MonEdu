package com.studymonitor;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.*;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.*;
import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
    @Bean SecretKey jwtKey(AppConfig.JwtSettings settings) {
        byte[] bytes=settings.secret().getBytes(StandardCharsets.UTF_8);
        if(bytes.length<32) throw new IllegalStateException("app.jwt.secret must contain at least 32 UTF-8 bytes");
        return new SecretKeySpec(bytes,"HmacSHA256");
    }
    @Bean JwtEncoder jwtEncoder(SecretKey key) {
        return NimbusJwtEncoder.withSecretKey(key).algorithm(MacAlgorithm.HS256).build();
    }
    @Bean JwtDecoder jwtDecoder(SecretKey key,AppConfig.JwtSettings settings,Clock clock) {
        NimbusJwtDecoder decoder=NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        JwtTimestampValidator time=new JwtTimestampValidator(Duration.ofSeconds(60));
        time.setClock(clock);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(time,new JwtIssuerValidator(settings.issuer()),jwt -> {
            try {
                UUID.fromString(jwt.getSubject());
                Api.Role.valueOf(jwt.getClaimAsString("role"));
                if(jwt.getExpiresAt()==null) throw new IllegalArgumentException();
                return OAuth2TokenValidatorResult.success();
            } catch(RuntimeException e) {
                return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token","Invalid user claims",null));
            }
        }));
        return decoder;
    }
    @Bean SecurityFilterChain security(HttpSecurity http,ObjectMapper json,
                                      @Value("${app.cors.allowed-origins}") List<String> origins,AuthCookies cookies) throws Exception {
        CorsConfiguration cors=new CorsConfiguration();
        if(origins.stream().anyMatch(origin -> origin.contains("*"))) throw new IllegalStateException("CORS requires explicit origins");
        cors.setAllowedOrigins(origins);
        cors.setAllowCredentials(true);
        cors.setExposedHeaders(List.of("Retry-After"));
        cors.setAllowedMethods(List.of("GET","POST","OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization","Content-Type","Accept"));
        UrlBasedCorsConfigurationSource source=new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/**",cors);
        JwtGrantedAuthoritiesConverter authorities=new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName("role"); authorities.setAuthorityPrefix("ROLE_");
        JwtAuthenticationConverter converter=new JwtAuthenticationConverter(); converter.setJwtGrantedAuthoritiesConverter(authorities);
        var bearerTokens=new DefaultBearerTokenResolver();
        return http.csrf(c -> c.disable()).cors(c -> c.configurationSource(source))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ASYNC,jakarta.servlet.DispatcherType.ERROR).permitAll()
                .requestMatchers("/api/v1/auth/**","/v3/api-docs/**","/swagger-ui/**","/swagger-ui.html","/actuator/health").permitAll()
                .requestMatchers("/api/v1/teacher/**").hasRole("TEACHER")
                .requestMatchers("/api/v1/me/stream","/api/v1/me/study-days/**","/api/v1/me/teachers").hasRole("STUDENT")
                .anyRequest().authenticated())
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req,res,ex) -> {
                    if(req.getRequestURI().equals("/api/v1/auth/refresh")) cookies.clear(res,"sm_rt",AuthCookies.AUTH_PATH);
                    problem(res,json,HttpStatus.UNAUTHORIZED,"UNAUTHORIZED");
                })
                .accessDeniedHandler((req,res,ex) -> problem(res,json,HttpStatus.FORBIDDEN,"FORBIDDEN")))
            .oauth2ResourceServer(o -> o
                // These operations authenticate with credentials or their own cookies. An unrelated
                // expired access token must not prevent refresh, provider login or unconditional logout.
                .bearerTokenResolver(req -> req.getRequestURI().startsWith("/api/v1/auth/")?null:bearerTokens.resolve(req))
                .jwt(j -> j.jwtAuthenticationConverter(converter))
                .authenticationEntryPoint((req,res,ex) -> {
                    if(req.getRequestURI().equals("/api/v1/auth/refresh")) cookies.clear(res,"sm_rt",AuthCookies.AUTH_PATH);
                    problem(res,json,HttpStatus.UNAUTHORIZED,"UNAUTHORIZED");
                })
                .accessDeniedHandler((req,res,ex) -> problem(res,json,HttpStatus.FORBIDDEN,"FORBIDDEN")))
            .build();
    }
    private static void problem(HttpServletResponse res,ObjectMapper json,HttpStatus status,String code) throws java.io.IOException {
        res.setStatus(status.value()); res.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        res.getWriter().write(json.writeValueAsString(Map.of("type","about:blank","title",status.getReasonPhrase(),"status",status.value(),"code",code)));
    }
}
