package com.studymonitor;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.boot.context.TypeExcludeFilter;
import org.springframework.core.type.classreading.*;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import static org.assertj.core.api.Assertions.*;

/** Upgrade a real prior-version schema, then boot the current application's full web bean graph.
 * ContextRunner uses a mock servlet context, so no service port is opened. */
@Testcontainers
class MigrationUpgradeTests {
    @Container static final PostgreSQLContainer POSTGRES=new PostgreSQLContainer("postgres:17-alpine");
    JdbcTemplate jdbc;

    // A plain ContextRunner must exclude @TestConfiguration just like @SpringBootTest does;
    // otherwise the shared @ServiceConnection fixture silently substitutes a fresh database.
    static class ExcludeTestComponents extends TypeExcludeFilter {
        @Override public boolean match(MetadataReader reader,MetadataReaderFactory factory) throws java.io.IOException {
            return new AnnotationTypeFilter(TestComponent.class).match(reader,factory);
        }
    }

    @BeforeEach void resetDatabase() {
        jdbc=new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }
    void migrateLegacy(boolean seeded) throws Exception { migrateLegacy(seeded,false); }
    void migrateLegacy(boolean seeded,boolean v2) throws Exception {
        // Copy actual migration bytes, excluding V2, so checksums match the original release.
        Path directory=Files.createTempDirectory(Files.createDirectories(Path.of("build/migration-upgrade-fixtures")),"legacy-");
        List<String> resources=new ArrayList<>(List.of("db/migration/V1__init.sql"));
        if(v2) resources.add("db/migration/V2__interval_session_index.sql");
        if(seeded) resources.add("db/seed/V1000__demo_seed.sql");
        try {
            for(String resource:resources) {
                try(var input=getClass().getClassLoader().getResourceAsStream(resource)) {
                    Objects.requireNonNull(input,resource);
                    Files.copy(input,directory.resolve(Path.of(resource).getFileName()));
                }
            }
            Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword())
                .locations("filesystem:"+directory.toAbsolutePath()).load().migrate();
        } finally {
            try(var files=Files.walk(directory)) {
                for(Path file:files.sorted(Comparator.reverseOrder()).toList()) Files.delete(file);
            }
        }
        List<String> expected=new ArrayList<>(List.of("1")); if(v2) expected.add("2"); if(seeded) expected.add("1000");
        assertThat(versions()).containsExactlyElementsOf(expected);
        assertThat(indexExists()).isEqualTo(v2);
    }
    List<String> versions() {
        return jdbc.queryForList("select version from flyway_schema_history where success order by installed_rank",String.class);
    }
    boolean indexExists() {
        return jdbc.queryForObject("select to_regclass('public.activity_intervals_session_start_idx') is not null",Boolean.class);
    }
    void boot(boolean seeded,Consumer<JdbcTemplate> assertions) {
        new WebApplicationContextRunner()
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withBean(ExcludeTestComponents.class,ExcludeTestComponents::new)
            .withUserConfiguration(StudyMonitorBackendApplication.class)
            .withPropertyValues("spring.datasource.url="+POSTGRES.getJdbcUrl(),
                "spring.datasource.username="+POSTGRES.getUsername(),"spring.datasource.password="+POSTGRES.getPassword(),
                "app.jwt.secret="+UUID.randomUUID()+UUID.randomUUID(),"app.seed-demo-data="+seeded,
                "app.monitoring.timeout-scan-interval=PT1H","app.monitoring.sse-ping-interval=PT1H")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).hasSingleBean(SessionService.class).hasSingleBean(Flyway.class);
                String url=context.getBean(JdbcTemplate.class).execute(
                    (org.springframework.jdbc.core.ConnectionCallback<String>) connection -> connection.getMetaData().getURL());
                assertThat(url).contains("localhost:"+POSTGRES.getMappedPort(5432)+"/");
                context.getBean(Flyway.class).validate();
                assertThat(context.getBean(AppConfig.Auth.class).cookieSecure()).isTrue();
                assertThat(context.getBean(AppConfig.Auth.class).ipLimitPerMinute()).isEqualTo(30);
                assertThat(context.getBean(AppConfig.Auth.class).refreshIpLimitPerMinute()).isEqualTo(120);
                assertThat(context.getBean(AppConfig.Kakao.class).enabled()).isFalse();
                assertThat(indexExists()).isTrue();
                assertions.accept(context.getBean(JdbcTemplate.class));
            });
    }
    Map<String,List<Map<String,Object>>> existingStudyData() {
        return Map.of("users",jdbc.queryForList("select id,email,password_hash,display_name,role,created_at from users order by id"),
            "assignments",jdbc.queryForList("select * from teacher_students order by teacher_id,student_id"),
            "sessions",jdbc.queryForList("select * from study_sessions order by id"),
            "intervals",jdbc.queryForList("select * from activity_intervals order by id"));
    }
    void addStudyHistory() {
        jdbc.update("update users set display_name='Preserve this student' where email='student1@demo.local'");
        jdbc.execute("""
            insert into study_sessions(id,student_id,status,study_date,started_at,ended_at,end_reason,
                current_state,current_state_since,verified_until,created_at)
            values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
                'ENDED',current_date,now()-interval '2 minutes',now()-interval '1 minute','SESSION_ENDED',
                'FOCUS_ESTIMATED',now()-interval '2 minutes',now()-interval '1 minute',now())
            """);
        jdbc.execute("""
            insert into activity_intervals(id,session_id,student_id,state,reason,started_at,ended_at,created_at)
            select '40000000-0000-0000-0000-000000000001',id,student_id,'FOCUS_ESTIMATED','SEATED_CONFIRMED',
                started_at,ended_at,created_at from study_sessions
            """);
    }
    @ParameterizedTest @ValueSource(booleans={true,false})
    void existingV1AndDemoSeedUpgradeWithoutDataLoss(boolean enableSeedAtBoot) throws Exception {
        migrateLegacy(true); addStudyHistory(); var before=existingStudyData();
        boot(enableSeedAtBoot,db -> {
            assertThat(versions()).containsExactly("1","1000","2","3","4");
            assertThat(existingStudyData()).isEqualTo(before);
        });
    }
    @Test void alreadyAppliedOutOfOrderV2BootsWithoutReapplyingIt() throws Exception {
        migrateLegacy(true); addStudyHistory();
        Path directory=Files.createTempDirectory(Files.createDirectories(Path.of("build/migration-upgrade-fixtures")),"pre-v3-");
        try {
            for(String resource:List.of("db/migration/V1__init.sql","db/migration/V2__interval_session_index.sql","db/seed/V1000__demo_seed.sql")) {
                try(var input=getClass().getClassLoader().getResourceAsStream(resource)) {
                    Files.copy(Objects.requireNonNull(input),directory.resolve(Path.of(resource).getFileName()));
                }
            }
            Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword())
                .locations("filesystem:"+directory.toAbsolutePath()).outOfOrder(true).load().migrate();
        } finally {
            try(var files=Files.walk(directory)) {
                for(Path file:files.sorted(Comparator.reverseOrder()).toList()) Files.delete(file);
            }
        }
        assertThat(versions()).containsExactly("1","1000","2"); var before=existingStudyData();
        boot(true,db -> {
            assertThat(versions()).containsExactly("1","1000","2","3","4");
            assertThat(existingStudyData()).isEqualTo(before);
        });
    }
    @Test void alreadyAppliedV1V2AndV1000UpgradeToV3WithoutDataLoss() throws Exception {
        migrateLegacy(true,true); addStudyHistory();
        assertThat(versions()).containsExactly("1","2","1000");
        var before=existingStudyData();
        boot(true,db -> {
            assertThat(versions()).containsExactly("1","2","1000","3","4");
            assertThat(existingStudyData()).isEqualTo(before);
            assertThat(db.queryForObject("select count(*) from users where terms_agreed_at is null and privacy_agreed_at is null and agreements_version is null",Integer.class)).isEqualTo(5);
            assertThat(db.queryForObject("select is_nullable from information_schema.columns where table_name='users' and column_name='email'",String.class)).isEqualTo("YES");
            assertThat(db.queryForObject("select is_nullable from information_schema.columns where table_name='users' and column_name='password_hash'",String.class)).isEqualTo("YES");
            for(String table:List.of("refresh_tokens","user_identities","teacher_invite_codes"))
                assertThat(db.queryForObject("select count(*) from "+table,Integer.class)).isZero();
        });
        boot(true,db -> {
            assertThat(versions()).containsExactly("1","2","1000","3","4");
            assertThat(existingStudyData()).isEqualTo(before);
        });
    }
    @Test void freshDemoDatabaseStillMigratesAndSeedsInOrder() {
        boot(true,db -> {
            assertThat(versions()).containsExactly("1","2","3","4","1000");
            assertThat(db.queryForObject("select count(*) from users",Integer.class)).isEqualTo(5);
            assertThat(db.queryForObject("select count(*) from teacher_students",Integer.class)).isEqualTo(3);
        });
    }
    @ParameterizedTest @ValueSource(booleans={false,true})
    void seedlessDatabaseBootsWithoutDemoAccounts(boolean existingV1) throws Exception {
        if(existingV1) migrateLegacy(false);
        boot(false,db -> {
            assertThat(versions()).containsExactly("1","2","3","4");
            assertThat(db.queryForObject("select count(*) from users",Integer.class)).isZero();
        });
    }
}
