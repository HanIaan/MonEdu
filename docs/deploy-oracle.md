# Oracle Cloud 무료 서버 배포 안내

MonEdu 전체(프론트·백엔드·DB)를 Oracle Cloud 상시 무료 서버 한 대에 올리고, 무료 주소(DuckDNS) 하나로 HTTPS 서비스하는 방법입니다.

```
학생 브라우저 ──HTTPS──▶ monedu.duckdns.org (Oracle 서버 한 대)
                           └ Caddy : HTTPS 인증서 자동 발급
                               ├ /api/*  → 백엔드 (Spring Boot)  → PostgreSQL
                               └ 그 외   → 프론트 (Next.js)
```

주소가 하나뿐이라 로그인 쿠키가 같은 사이트 안에서만 오가고, 카카오 로그인과 새로고침 후 로그인 유지가 그대로 동작합니다.
설정 파일은 `deploy/oracle/`에 있습니다.

| 파일 | 하는 일 |
|---|---|
| `docker-compose.yml` | DB·백엔드·프론트·Caddy를 한 번에 실행 |
| `Caddyfile` | HTTPS와 `/api` 연결 설정 |
| `.env.example` | 서버 비밀값 목록(복사해서 `.env`로 채움, 저장소에 올리지 않음) |
| `setup-server.sh` | 새 서버 1회 설정(Docker 설치, 방화벽, 코드 받기, 백업·주소 갱신 예약) |
| `deploy.sh` | 최신 코드 받아서 다시 빌드·실행(언제 다시 실행해도 안전) |
| `backup-db.sh` | 매일 새벽 4시(UTC) DB 백업, 14일 보관 |
| `duckdns.sh` | DuckDNS 주소를 서버 IP로 갱신(5분마다) |

## 1. Oracle Cloud 서버 만들기 (웹 콘솔)
1. 콘솔 왼쪽 위 메뉴 → **컴퓨트 → 인스턴스 → 인스턴스 생성**.
2. 이름: `monedu`.
3. **이미지**: Canonical **Ubuntu 24.04** (또는 22.04).
4. **구성(Shape)**: "Shape 변경" → **Ampere → VM.Standard.A1.Flex**, OCPU **2**, 메모리 **12GB**
   ("Always Free 적격" 표시 확인). 자리가 없다는 오류(Out of capacity)가 나면 다른 가용성 도메인(AD)을 고르거나 나중에 다시 시도합니다.
5. **네트워킹**: 새 VCN·공용 서브넷 생성, **공용 IPv4 주소 할당** 체크.
6. **SSH 키**: "키 쌍 생성" → **개인 키 저장**(예: `~/Downloads/ssh-key-monedu.key`). 이 파일이 없으면 서버에 접속할 수 없습니다.
7. **생성** → 상태가 "실행 중"이 되면 **공용 IP 주소**를 메모합니다.

## 2. 웹 콘솔에서 80·443 포트 열기
인스턴스 상세 → **서브넷** → **보안 목록(Default Security List)** → **수신 규칙 추가**:

| 소스 CIDR | IP 프로토콜 | 대상 포트 |
|---|---|---|
| `0.0.0.0/0` | TCP | `80,443` |
| `0.0.0.0/0` | UDP | `443` |

서버 안쪽 방화벽은 `setup-server.sh`가 열어 줍니다. Oracle은 두 군데를 모두 열어야 접속됩니다.

## 3. 무료 주소 만들기 (DuckDNS)
1. https://www.duckdns.org → GitHub 등으로 로그인.
2. 원하는 이름 입력(예: `monedu`) → **add domain** → 주소 `monedu.duckdns.org` 생성.
3. 화면 위쪽의 **token** 값을 복사해 둡니다(`.env`에 넣음).

## 4. 서버 접속과 1회 설정 (Mac 터미널)
```bash
chmod 600 ~/Downloads/ssh-key-monedu.key
ssh -i ~/Downloads/ssh-key-monedu.key ubuntu@<공용 IP>
```
서버 안에서:
```bash
git clone --branch phase2/final-verification https://github.com/HanIaan/MonEdu.git ~/MonEdu
bash ~/MonEdu/deploy/oracle/setup-server.sh
exit   # docker 권한 적용을 위해 한 번 나갔다가 다시 접속
```

## 5. 비밀값 채우기
다시 접속한 뒤:
```bash
cd ~/MonEdu/deploy/oracle
cp .env.example .env
openssl rand -base64 24   # → POSTGRES_PASSWORD 에 붙여 넣기
openssl rand -base64 48   # → JWT_SECRET 에 붙여 넣기
nano .env                 # DOMAIN, 위 두 값, DuckDNS 값, (선택) 카카오 키 입력 → Ctrl+O 저장, Ctrl+X 종료
```

## 6. 실행
```bash
./duckdns.sh    # "OK" 가 나오면 주소가 이 서버로 연결됨
./deploy.sh     # 첫 빌드는 10분 안팎
```
`https://<DOMAIN>` 에 접속해 회원가입 → 공부 시작 → 설정 → 탈퇴까지 한 번 확인합니다.

## 7. 카카오 로그인 연결 (사용할 때만)
Kakao Developers → 내 애플리케이션 →
- **플랫폼 → Web 사이트 도메인**: `https://<DOMAIN>`
- **카카오 로그인 → Redirect URI**: `https://<DOMAIN>/api/v1/auth/kakao/callback`

`.env`에 `KAKAO_REST_API_KEY`(필요하면 `KAKAO_CLIENT_SECRET`)를 넣고 `./deploy.sh`를 다시 실행합니다.

## 운영
| 하고 싶은 일 | 명령 (서버의 `~/MonEdu/deploy/oracle` 에서) |
|---|---|
| 새 코드 반영 | GitHub에 push 후 `./deploy.sh` |
| 상태 보기 | `docker compose ps` |
| 로그 보기 | `docker compose logs -f backend` (`frontend`, `caddy` 도 가능) |
| 전체 재시작 | `docker compose restart` |
| 지금 바로 백업 | `./backup-db.sh` (파일은 `~/monedu-backups`) |
| 백업 복원 | `gunzip -c ~/monedu-backups/파일.sql.gz \| docker compose exec -T postgres psql -U monedu -d monedu` |

## 알아 둘 점
- 백업은 같은 서버 디스크에 저장됩니다. 중요한 데이터가 쌓이면 가끔 내 PC로도 내려받아 두세요:
  `scp -i <키> ubuntu@<IP>:~/monedu-backups/최신파일.sql.gz .`
- `JWT_SECRET`을 바꾸면 모든 사용자가 로그아웃됩니다.
- 공용 IP는 인스턴스를 중지했다 켜면 바뀔 수 있습니다. 5분마다 실행되는 `duckdns.sh`가 주소를 새 IP로 자동으로 맞춥니다.
- Oracle은 오래 거의 쓰이지 않는 무료 인스턴스를 회수할 수 있다고 안내합니다. 최신 조건은 Oracle 공식 문서를 확인하세요.
- 서버 시간대는 UTC이고, 앱 화면의 시간은 서울 시간으로 표시됩니다.
