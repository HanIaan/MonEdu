package com.studymonitor;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.TestConfiguration;
import java.time.Duration;
import static org.assertj.core.api.Assertions.*;

class AuthConfigurationTests {
    @TestConfiguration(proxyBeanMethods=false)
    @EnableConfigurationProperties({AppConfig.Auth.class,AppConfig.Kakao.class})
    static class Binding {}
    ApplicationContextRunner runner() {
        return new ApplicationContextRunner().withInitializer(new ConfigDataApplicationContextInitializer()).withUserConfiguration(Binding.class);
    }
    @Test void productionDefaultsKeepDemoOffCookiesSecureAndKakaoOptional() {
        runner().run(context -> {
            assertThat(context).hasNotFailed(); var auth=context.getBean(AppConfig.Auth.class);
            assertThat(auth.cookieSecure()).isTrue(); assertThat(auth.trustedProxy()).isFalse();
            assertThat(auth.refreshTtl()).isEqualTo(Duration.ofDays(14)); assertThat(auth.refreshReuseGrace()).isEqualTo(Duration.ofSeconds(30));
            assertThat(auth.ipLimitPerMinute()).isEqualTo(30); assertThat(auth.refreshIpLimitPerMinute()).isEqualTo(120);
            assertThat(auth.agreementsVersion()).isEqualTo("2026-11-04");
            assertThat(context.getBean(AppConfig.Kakao.class).enabled()).isFalse();
            assertThat(context.getEnvironment().getProperty("app.seed-demo-data",Boolean.class)).isFalse();
        });
    }
    @Test void everyNewEnvironmentVariableBindsIncludingIndependentIpLimits() {
        runner().withPropertyValues("REFRESH_TTL=P2D","REFRESH_REUSE_GRACE=PT12S","AUTH_COOKIE_SECURE=false",
            "AGREEMENTS_VERSION=testing-version","TRUSTED_PROXY=true","AUTH_IP_LIMIT_PER_MINUTE=7","REFRESH_IP_LIMIT_PER_MINUTE=17",
            "FRONTEND_BASE_URL=https://frontend.example.test","KAKAO_REST_API_KEY=test-placeholder","KAKAO_CLIENT_SECRET=",
            "KAKAO_REDIRECT_URI=https://backend.example.test/api/v1/auth/kakao/callback",
            "KAKAO_AUTH_BASE_URL=http://localhost:12345","KAKAO_API_BASE_URL=http://localhost:23456")
            .run(context -> {
                assertThat(context).hasNotFailed(); var auth=context.getBean(AppConfig.Auth.class); var kakao=context.getBean(AppConfig.Kakao.class);
                assertThat(auth.refreshTtl()).isEqualTo(Duration.ofDays(2)); assertThat(auth.refreshReuseGrace()).isEqualTo(Duration.ofSeconds(12));
                assertThat(auth.cookieSecure()).isFalse(); assertThat(auth.trustedProxy()).isTrue(); assertThat(auth.agreementsVersion()).isEqualTo("testing-version");
                assertThat(auth.ipLimitPerMinute()).isEqualTo(7); assertThat(auth.refreshIpLimitPerMinute()).isEqualTo(17);
                assertThat(auth.frontendBaseUrl()).isEqualTo("https://frontend.example.test"); assertThat(kakao.enabled()).isTrue();
                assertThat(kakao.clientSecret()).isEmpty(); assertThat(kakao.authBaseUrl()).isEqualTo("http://localhost:12345"); assertThat(kakao.apiBaseUrl()).isEqualTo("http://localhost:23456");
            });
    }
}
