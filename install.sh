#!/usr/bin/env bash
# DeepTank 一键安装 / 更新脚本
# 用法：curl -sSL https://raw.githubusercontent.com/zzfn/Chassis/main/install.sh | bash
set -euo pipefail

REPO="zzfn/Chassis"
INSTALL_DIR="/opt/deeptank"
BIN_PATH="/usr/local/bin/deeptank"
WEB_DIR="$INSTALL_DIR/web"
SERVICE_ENGINE="deeptank-engine"
SERVICE_WEB="deeptank-web"

# ── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deeptank]${NC} $*"; }
success() { echo -e "${GREEN}[deeptank]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deeptank]${NC} $*"; }
die()     { echo -e "${RED}[deeptank] 错误:${NC} $*" >&2; exit 1; }

# curl | bash 时 stdin 是管道，必须从 /dev/tty 读取用户输入
ask() {
  local prompt="$1" default="${2:-}" var
  if [ -n "$default" ]; then
    printf "${BOLD}%s${NC} [默认: %s]: " "$prompt" "$default" > /dev/tty
  else
    printf "${BOLD}%s${NC}: " "$prompt" > /dev/tty
  fi
  read -r var < /dev/tty
  [ -z "$var" ] && var="$default"
  echo "$var"
}

ask_secret() {
  local prompt="$1" default="${2:-}" var
  if [ -n "$default" ]; then
    printf "${BOLD}%s${NC} [默认: %s]: " "$prompt" "$default" > /dev/tty
  else
    printf "${BOLD}%s${NC} (留空自动生成): " "$prompt" > /dev/tty
  fi
  read -rs var < /dev/tty
  echo "" > /dev/tty
  [ -z "$var" ] && var="$default"
  echo "$var"
}

gen_secret() {
  # 生成 64 字符随机字符串
  cat /dev/urandom | tr -dc 'A-Za-z0-9!@#%^&*' | head -c 64 2>/dev/null || \
    openssl rand -base64 48 | tr -d '\n'
}

# ── 前置检查 ─────────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "仅支持 Linux"
command -v curl  >/dev/null || die "需要 curl"
command -v tar   >/dev/null || die "需要 tar"
[ "$(id -u)" -eq 0 ] || die "请用 sudo 或 root 运行"

# ── 检测架构 ─────────────────────────────────────────────────────────────────
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)         BINARY_NAME="deeptank-linux-amd64" ;;
  aarch64|arm64)  BINARY_NAME="deeptank-linux-arm64" ;;
  *) die "不支持的架构：$ARCH" ;;
esac

# ── 获取最新 Release ──────────────────────────────────────────────────────────
info "获取最新版本信息..."
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
RELEASE_JSON="$(curl -sSf "$API_URL")" || die "无法访问 GitHub API，请检查网络"
TAG="$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
[ -n "$TAG" ] || die "未找到任何 Release，请先推送一个 tag（如 git tag v1.0.0 && git push --tags）"

# ── 对比当前版本 ──────────────────────────────────────────────────────────────
CURRENT=""
[ -f "$INSTALL_DIR/VERSION" ] && CURRENT="$(cat "$INSTALL_DIR/VERSION")"
if [ "$CURRENT" = "$TAG" ]; then
  success "已是最新版本 $TAG，无需更新。"
  exit 0
fi

[ -n "$CURRENT" ] && info "从 $CURRENT 升级到 $TAG" || info "全新安装 $TAG"

# ── 询问环境变量（首次安装或 .env 缺失时）───────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo -e "${BOLD}  DeepTank 配置向导${NC}"
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo ""

  # 数据库连接串
  echo -e "${CYAN}▶ 数据库${NC}"
  echo "  格式：postgres://用户名:密码@主机:端口/数据库名"
  DB_URL="$(ask "DATABASE_URL" "postgres://deeptank:deeptank@localhost:5432/deeptank")"

  echo ""

  # JWT 密钥
  echo -e "${CYAN}▶ JWT 密钥${NC}"
  echo "  用于签发登录 Token，建议 32 字符以上随机字符串"
  JWT_RAW="$(ask_secret "JWT_SECRET")"
  if [ -z "$JWT_RAW" ]; then
    JWT_RAW="$(gen_secret)"
    info "已自动生成 JWT_SECRET"
  fi

  echo ""

  # 端口
  echo -e "${CYAN}▶ 端口${NC}"
  ENGINE_PORT="$(ask "引擎 API 端口（ENGINE_PORT）" "3001")"
  WEB_PORT="$(ask "前端页面端口（WEB_PORT）" "3000")"

  echo ""

  # DEEPSEEK_API_KEY（可选）
  echo -e "${CYAN}▶ DeepSeek API Key（可选，用于 AI 生成坦克外观）${NC}"
  DEEPSEEK_KEY="$(ask_secret "DEEPSEEK_API_KEY")"

  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"

  # 写入 .env（目录还没建，先创建）
  mkdir -p "$INSTALL_DIR"
  cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=${DB_URL}
JWT_SECRET=${JWT_RAW}
ENGINE_PORT=${ENGINE_PORT}
WEB_PORT=${WEB_PORT}
ENVEOF

  [ -n "$DEEPSEEK_KEY" ] && echo "DEEPSEEK_API_KEY=${DEEPSEEK_KEY}" >> "$ENV_FILE"

  success ".env 已写入 $ENV_FILE"
else
  info ".env 已存在，跳过配置向导（如需重新配置请删除 $ENV_FILE）"
  # 从现有 .env 读取端口，供 systemd 服务文件使用
  ENGINE_PORT="$(grep '^ENGINE_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' ')"
  WEB_PORT="$(grep    '^WEB_PORT='    "$ENV_FILE" | cut -d= -f2 | tr -d ' ')"
  ENGINE_PORT="${ENGINE_PORT:-3001}"
  WEB_PORT="${WEB_PORT:-3000}"
fi

# ── 构造下载 URL ──────────────────────────────────────────────────────────────
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
BIN_URL="${BASE_URL}/${BINARY_NAME}"
WEB_URL="${BASE_URL}/deeptank-web.tar.gz"

# ── 下载到临时目录 ────────────────────────────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "下载 $BINARY_NAME..."
curl -sSfL "$BIN_URL" -o "$TMP/deeptank" || die "下载二进制失败：$BIN_URL"
chmod +x "$TMP/deeptank"

info "下载 deeptank-web.tar.gz..."
curl -sSfL "$WEB_URL" -o "$TMP/web.tar.gz" || die "下载前端失败：$WEB_URL"

# ── 停止旧服务 ────────────────────────────────────────────────────────────────
for svc in "$SERVICE_ENGINE" "$SERVICE_WEB"; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    info "停止 $svc..."
    systemctl stop "$svc"
  fi
done

# ── 安装文件 ──────────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR" "$WEB_DIR"

install -m 755 "$TMP/deeptank" "$BIN_PATH"
info "二进制已安装到 $BIN_PATH"

info "解压前端..."
rm -rf "$WEB_DIR"
mkdir -p "$WEB_DIR"
tar -xzf "$TMP/web.tar.gz" -C "$WEB_DIR"
info "前端已安装到 $WEB_DIR"

echo "$TAG" > "$INSTALL_DIR/VERSION"

# ── 写 systemd 服务（首次写入，升级保留用户修改）────────────────────────────
write_service() {
  local name="$1" file="/etc/systemd/system/${name}.service"
  shift
  if [ -f "$file" ]; then
    info "$name.service 已存在，跳过（如需重置：rm $file && 重新执行安装脚本）"
    return
  fi
  cat > "$file"
  info "已创建 $file"
}

write_service "$SERVICE_ENGINE" <<SVCEOF
[Unit]
Description=DeepTank 引擎（Rust）
After=network.target postgresql.service

[Service]
Type=simple
User=nobody
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_PATH --serve \${ENGINE_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

write_service "$SERVICE_WEB" <<SVCEOF
[Unit]
Description=DeepTank 前端（Next.js）
After=network.target $SERVICE_ENGINE.service

[Service]
Type=simple
User=nobody
WorkingDirectory=$WEB_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

# ── 检测 Node.js ──────────────────────────────────────────────────────────────
if ! command -v node >/dev/null; then
  warn "未检测到 node，前端服务将无法启动。"
  warn "安装 Node.js 20：curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
fi

# ── 启动服务 ──────────────────────────────────────────────────────────────────
systemctl daemon-reload
for svc in "$SERVICE_ENGINE" "$SERVICE_WEB"; do
  systemctl enable "$svc"
  systemctl start  "$svc"
  if systemctl is-active --quiet "$svc"; then
    success "$svc 已启动"
  else
    warn "$svc 启动失败，查看日志：journalctl -u $svc -n 50"
  fi
done

# ── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  DeepTank $TAG 安装完成！${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo ""
echo "  引擎 API ：http://localhost:${ENGINE_PORT}"
echo "  前端页面 ：http://localhost:${WEB_PORT}"
echo "  配置文件 ：$ENV_FILE"
echo ""
echo "  常用命令："
echo "    systemctl status  $SERVICE_ENGINE $SERVICE_WEB"
echo "    journalctl -u $SERVICE_ENGINE -f"
echo "    journalctl -u $SERVICE_WEB    -f"
echo ""
