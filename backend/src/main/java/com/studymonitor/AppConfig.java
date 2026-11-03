package com.studymonitor;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.flyway.autoconfigure.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.EnableScheduling;
import java.time.*;
import java.util.*;

@Configuration
@EnableScheduling
@EnableConfigurationProperties({AppConfig.JwtSettings.class,AppConfig.Monitoring.class})
public class AppConfig {
    @Bean Clock clock() { return Clock.systemUTC(); }
    @ConfigurationProperties("app.jwt")
    public record JwtSettings(String secret, Duration ttl, String issuer) {}
    @ConfigurationProperties("app.monitoring")
    public record Monitoring(Duration heartbeatInterval, Duration heartbeatTimeout, Duration timeoutScanInterval,
                             Duration maxFutureSkew, Duration liveEndGrace, Duration ssePingInterval) {}
    @Bean FlywayConfigurationCustomizer seedLocations(@org.springframework.beans.factory.annotation.Value("${app.seed-demo-data:false}") boolean seed) {
        return config -> {
            List<String> locations = new ArrayList<>(Arrays.stream(config.getLocations()).map(Object::toString).toList());
            // A seed path alone must never accidentally activate demo credentials in production.
            locations.removeIf(location -> location.equals("classpath:db/seed"));
            if (seed) locations.add("classpath:db/seed");
            config.locations(locations.toArray(String[]::new));
        };
    }
}
