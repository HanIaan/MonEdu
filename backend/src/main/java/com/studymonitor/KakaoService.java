package com.studymonitor;

import org.springframework.stereotype.Service;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.core.*;
import javax.crypto.SecretKey;
import tools.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import static com.studymonitor.Problems.*;
import static org.springframework.http.HttpStatus.*;

@Service
public class KakaoService {
    public record Profile(String id,String nickname) {}
    private final AppConfig.Kakao config; private final AppConfig.Auth settings; private final AppConfig.JwtSettings jwt;
    private final Clock clock; private final JwtEncoder encoder; private final JwtDecoder tickets; private final ObjectMapper json;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final SecureRandom random=new SecureRandom();
    public KakaoService(AppConfig.Kakao config,AppConfig.Auth settings,AppConfig.JwtSettings jwt,Clock clock,JwtEncoder encoder,SecretKey key,ObjectMapper json) {
        this.config=config; this.settings=settings; this.jwt=jwt; this.clock=clock; this.encoder=encoder; this.json=json;
        NimbusJwtDecoder decoder=NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        JwtTimestampValidator time=new JwtTimestampValidator(Duration.ZERO); time.setClock(clock);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(time,new JwtIssuerValidator(jwt.issuer()),token -> {
            boolean valid=token.getAudience().equals(List.of("kakao-signup")) && token.getExpiresAt()!=null && token.getSubject()!=null
                && token.getSubject().matches("[0-9]{1,64}") && token.getExpiresAt().isAfter(clock.instant());
            return valid?OAuth2TokenValidatorResult.success():OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
        }));
        tickets=decoder;
    }
    public void enabled() { if(!config.enabled()) throw fail(NOT_FOUND,"PROVIDER_DISABLED","카카오 로그인이 설정되지 않았습니다."); }
    public String frontend(String path) { return settings.frontendBaseUrl().replaceAll("/+$","")+path; }
    public String state() { byte[] bytes=new byte[16]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    public boolean stateMatches(String expected,String actual) {
        return expected!=null && actual!=null && !expected.isBlank() && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),actual.getBytes(StandardCharsets.UTF_8));
    }
    private String form(Map<String,String> data) {
        return data.entrySet().stream().map(e -> URLEncoder.encode(e.getKey(),StandardCharsets.UTF_8)+"="+URLEncoder.encode(e.getValue(),StandardCharsets.UTF_8)).collect(java.util.stream.Collectors.joining("&"));
    }
    public String authorize(String state) {
        enabled(); return config.authBaseUrl()+"/oauth/authorize?"+form(Map.of("response_type","code","client_id",config.restApiKey(),"redirect_uri",config.redirectUri(),"state",state));
    }
    public Profile exchange(String code) throws java.io.IOException,InterruptedException {
        enabled();
        if(code==null || code.isBlank()) throw new java.io.IOException("Missing authorization code");
        Map<String,String> values=new LinkedHashMap<>();
        values.put("grant_type","authorization_code"); values.put("client_id",config.restApiKey()); values.put("redirect_uri",config.redirectUri()); values.put("code",code);
        if(config.clientSecret()!=null && !config.clientSecret().isBlank()) values.put("client_secret",config.clientSecret());
        var response=http.send(HttpRequest.newBuilder(URI.create(config.authBaseUrl()+"/oauth/token")).timeout(Duration.ofSeconds(5))
            .header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form(values))).build(),HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()!=200) throw new java.io.IOException("Provider exchange failed");
        JsonNode token=json.readTree(response.body()).get("access_token");
        if(token==null || !token.isTextual() || token.asText().isBlank()) throw new java.io.IOException("Invalid provider response");
        var profile=http.send(HttpRequest.newBuilder(URI.create(config.apiBaseUrl()+"/v2/user/me")).timeout(Duration.ofSeconds(5))
            .header("Authorization","Bearer "+token.asText()).GET().build(),HttpResponse.BodyHandlers.ofString());
        if(profile.statusCode()!=200) throw new java.io.IOException("Provider profile failed");
        JsonNode data=json.readTree(profile.body()),id=data.get("id");
        if(id==null || !id.isIntegralNumber() || !id.asText().matches("[0-9]{1,64}")) throw new java.io.IOException("Invalid provider identity");
        JsonNode nickname=data.path("kakao_account").path("profile").path("nickname");
        return new Profile(id.asText(),nickname.isTextual()?nickname.asText():null);
    }
    public String ticket(Profile profile) {
        var builder=JwtClaimsSet.builder().issuer(jwt.issuer()).subject(profile.id()).audience(List.of("kakao-signup"))
            .issuedAt(clock.instant()).expiresAt(clock.instant().plus(Duration.ofMinutes(10))).id(UUID.randomUUID().toString());
        if(profile.nickname()!=null) builder.claim("nickname",profile.nickname());
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),builder.build())).getTokenValue();
    }
    public Profile pending(String ticket) {
        enabled();
        try {
            if(ticket==null || ticket.isBlank()) throw new IllegalArgumentException();
            Jwt claims=tickets.decode(ticket); return new Profile(claims.getSubject(),claims.getClaimAsString("nickname"));
        } catch(RuntimeException invalid) { throw fail(UNAUTHORIZED,"UNAUTHORIZED","카카오 가입 정보가 만료되었습니다. 다시 로그인해 주세요."); }
    }
}
