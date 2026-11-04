package com.studymonitor;

import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.io.*;
import java.util.*;
import static com.studymonitor.Problems.*;

@Component
public class AccountPolicy {
    private final Set<String> common;
    public AccountPolicy() throws IOException {
        try(var input=Objects.requireNonNull(getClass().getResourceAsStream("/common-passwords.txt"));
            var reader=new BufferedReader(new InputStreamReader(input,StandardCharsets.UTF_8))) {
            common=new HashSet<>(reader.lines().filter(line -> !line.isBlank()).toList());
        }
        if(common.size()<100) throw new IllegalStateException("Common-password resource must contain at least 100 entries");
    }
    public void password(String email,String password) {
        if(password==null || password.codePointCount(0,password.length())<8 || password.codePointCount(0,password.length())>64)
            throw field("password","비밀번호는 8~64자여야 합니다.");
        if(password.getBytes(StandardCharsets.UTF_8).length>72) throw field("password","비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.");
        if(!password.codePoints().anyMatch(Character::isLetter) || !password.codePoints().anyMatch(Character::isDigit))
            throw field("password","비밀번호에 문자와 숫자를 모두 포함해 주세요.");
        String local=email.substring(0,email.indexOf('@')).toLowerCase(Locale.ROOT);
        if(local.codePointCount(0,local.length())>=3 && password.toLowerCase(Locale.ROOT).contains(local))
            throw field("password","비밀번호에 이메일 아이디를 포함할 수 없습니다.");
        if(common.contains(password.toLowerCase(Locale.ROOT))) throw field("password","흔히 사용하는 비밀번호는 사용할 수 없습니다.");
    }
    public String displayName(String name) {
        if(name==null || name.codePoints().anyMatch(Character::isISOControl)) throw field("displayName","이름에 제어 문자를 사용할 수 없습니다.");
        String trimmed=name.strip();
        int length=trimmed.codePointCount(0,trimmed.length());
        if(length<1 || length>30) throw field("displayName","이름은 공백을 제외하고 1~30자여야 합니다.");
        return trimmed;
    }
    public void agreements(Api.Agreements agreements) {
        if(agreements==null) throw field("agreements","약관 동의가 필요합니다.");
        if(!Boolean.TRUE.equals(agreements.terms())) throw field("agreements.terms","이용약관에 동의해 주세요.");
        if(!Boolean.TRUE.equals(agreements.privacy())) throw field("agreements.privacy","개인정보 처리방침에 동의해 주세요.");
    }
}
