#!/usr/bin/env bash
# One-time setup of a fresh Oracle Cloud Ubuntu server (run as the default "ubuntu" user):
#   curl -fsSL https://raw.githubusercontent.com/HanIaan/MonEdu/phase2/final-verification/deploy/oracle/setup-server.sh | bash
# or, after cloning:  bash ~/MonEdu/deploy/oracle/setup-server.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/HanIaan/MonEdu.git}"
BRANCH="${BRANCH:-phase2/final-verification}"
APP_DIR="${APP_DIR:-$HOME/MonEdu}"

echo "==> 1/5 패키지 업데이트와 Docker 설치"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 git curl iptables-persistent
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "==> 2/5 서버 안쪽 방화벽에서 80/443 열기 (Oracle Ubuntu 이미지는 기본으로 막혀 있음)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save

echo "==> 3/5 메모리가 2GB 미만이면 스왑 2GB 추가"
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> 4/5 코드 내려받기 ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "==> 5/5 매일 새벽 DB 백업, 5분마다 DuckDNS 주소 갱신 예약"
chmod +x "$APP_DIR"/deploy/oracle/*.sh
( crontab -l 2>/dev/null | grep -v 'deploy/oracle/' ; \
  echo "0 4 * * * $APP_DIR/deploy/oracle/backup-db.sh >> $HOME/monedu-backup.log 2>&1" ; \
  echo "*/5 * * * * $APP_DIR/deploy/oracle/duckdns.sh >> $HOME/monedu-duckdns.log 2>&1" ) | crontab -

cat <<MSG

설정 완료. 다음 순서:
  1) 로그아웃 후 다시 접속 (docker 권한 적용):  exit
  2) cd $APP_DIR/deploy/oracle && cp .env.example .env && nano .env
  3) ./duckdns.sh   (주소를 이 서버로 연결)
  4) ./deploy.sh    (빌드 후 실행, 처음엔 10분 안팎)
MSG
