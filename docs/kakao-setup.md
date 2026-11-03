# 카카오 로그인 설정 방법

카카오 로그인은 Kakao Developers에 앱을 등록해야 켜집니다.
- 키는 **사용자가 직접** 발급해 `.env`에만 넣습니다. Git에 올리거나 채팅·로그에 붙여 넣지 마세요.
- 키가 없으면 서버는 정상으로 뜨지만, 로그인 화면에 카카오 버튼이 나오지 않습니다(`GET /api/v1/auth/providers` → `kakao: false`).

> Kakao Developers 콘솔은 메뉴 이름이 바뀔 때가 있습니다. 아래 이름이 다르면 같은 뜻의 메뉴를 찾아 주세요.

## 1. 앱 만들기
1. https://developers.kakao.com 에 카카오 계정으로 로그인합니다.
2. **내 애플리케이션 ▸ 애플리케이션 추가하기**를 누르고 앱 이름(예: Study Monitor), 회사명, 카테고리를 입력해 저장합니다.

## 2. 키 확인
1. **앱 설정 ▸ 앱 키**(또는 플랫폼 키)에서 **REST API 키**를 확인합니다. 이 값이 `KAKAO_REST_API_KEY`입니다.
2. **제품 설정 ▸ 카카오 로그인 ▸ 보안**에서 **Client Secret 코드를 생성**하고, 활성화 상태를 **사용함**으로 바꿉니다(권장).
   이 값이 `KAKAO_CLIENT_SECRET`입니다.

## 3. 카카오 로그인 켜기
1. **제품 설정 ▸ 카카오 로그인**에서 활성화 설정을 **ON**으로 바꿉니다.
2. **Redirect URI**에 아래 주소를 정확히 등록합니다(백엔드 주소입니다. 프론트 주소가 아닙니다).
   ```
   http://localhost:8080/api/v1/auth/kakao/callback
   ```
3. **동의항목**에서 **닉네임(profile_nickname)**을 "선택 동의"나 "필수 동의"로 설정합니다.
   이메일, 프로필 사진 같은 다른 항목은 필요 없습니다. 이 서비스는 카카오 회원번호와 사용자가 입력한 이름만 저장합니다.
4. **앱 설정 ▸ 플랫폼 ▸ Web**에 사이트 도메인 `http://localhost:3000`을 등록합니다.

## 4. `.env`에 넣기
저장소 루트의 `.env`(Git에 올라가지 않음)에 다음을 추가합니다.
```
KAKAO_REST_API_KEY=<REST API 키>
KAKAO_CLIENT_SECRET=<Client Secret>
KAKAO_REDIRECT_URI=http://localhost:8080/api/v1/auth/kakao/callback
FRONTEND_BASE_URL=http://localhost:3000
AUTH_COOKIE_SECURE=false
```
그다음 백엔드를 재시작합니다. 로그인 화면에 노란색 "카카오 로그인" 버튼이 보이면 설정이 끝난 것입니다.

## 5. 동작 확인
1. 로그인 화면에서 "카카오 로그인"을 누르면 카카오 동의 화면이 나오고, 동의하면 서비스로 돌아옵니다.
2. 처음 로그인하면 "역할(학생/선생님) · 이름 · 약관 동의" 화면이 나옵니다. 저장하면 가입이 끝납니다.
3. 로그아웃한 뒤 다시 카카오 로그인을 하면 바로 들어가집니다.
4. 카카오 동의 화면에서 "취소"를 누르면 로그인 화면에 "카카오 로그인을 취소했습니다"류의 안내가 나옵니다.

## 6. 실제 운영으로 옮길 때
- Redirect URI를 HTTPS 운영 주소로 바꿔 등록합니다. 예: `https://api.example.com/api/v1/auth/kakao/callback`.
  같은 값을 `KAKAO_REDIRECT_URI`에도 넣습니다.
- `AUTH_COOKIE_SECURE=true`로 설정하고, `FRONTEND_BASE_URL`과 `CORS_ALLOWED_ORIGINS`를 운영 프론트 주소로 바꿉니다.
- 프론트와 API는 같은 사이트여야 합니다(예: `app.example.com` + `api.example.com`).
  다른 도메인이면 로그인 유지 쿠키가 전달되지 않습니다.
- 카카오 정책상 앱이 개발 단계일 때는 이용 가능한 사용자나 동의항목이 제한될 수 있습니다. 운영 전에 콘솔의 검수·비즈 앱 요건을 확인하세요.
- 키가 노출됐다면 콘솔에서 Client Secret을 재발급하고 `.env`를 바꿔 주세요.
