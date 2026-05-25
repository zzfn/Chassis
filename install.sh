#!/usr/bin/env bash
# DeepTank 一键安装 / 更新脚本（引擎 + 数据库，前端由 Vercel 托管）
# 用法：curl -sSL https://raw.githubusercontent.com/zzfn/Chassis/main/install.sh | bash
set -euo pipefail

REPO="zzfn/Chassis"
INSTALL_DIR="/opt/deeptank"
BIN_PATH="/usr/local/bin/deeptank"
SERVICE="deeptank-engine"

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
  local prompt="$1" var
  printf "${BOLD}%s${NC} (留空自动生成): " "$prompt" > /dev/tty
  read -rs var < /dev/tty
  echo "" > /dev/tty
  echo "$var"
}

gen_secret() {
  cat /dev/urandom | tr -dc 'A-Za-z0-9!@#%^&*' | head -c 64 2>/dev/null || \
    openssl rand -base64 48 | tr -d '\n'
}

# ── 前置检查 ─────────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "仅支持 Linux"
command -v curl >/dev/null || die "需要 curl"
[ "$(id -u)" -eq 0 ] || die "请用 sudo 或 root 运行"

# 检测包管理器
if command -v apt-get >/dev/null; then
  PKG_MANAGER="apt"
elif command -v dnf >/dev/null; then
  PKG_MANAGER="dnf"
elif command -v yum >/dev/null; then
  PKG_MANAGER="yum"
else
  die "不支持的发行版，需要 apt / dnf / yum"
fi

# ── 检测架构 ─────────────────────────────────────────────────────────────────
case "$(uname -m)" in
  x86_64)        BINARY_NAME="deeptank-linux-amd64" ;;
  aarch64|arm64) BINARY_NAME="deeptank-linux-arm64" ;;
  *) die "不支持的架构：$(uname -m)" ;;
esac

# ── 获取最新 Release ──────────────────────────────────────────────────────────
info "获取最新版本信息..."
RELEASE_JSON="$(curl -sSf "https://api.github.com/repos/${REPO}/releases/latest")" \
  || die "无法访问 GitHub API，请检查网络"
TAG="$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
[ -n "$TAG" ] || die "未找到任何 Release，请先推送 tag（git tag v1.0.0 && git push --tags）"

# ── 对比当前版本 ──────────────────────────────────────────────────────────────
CURRENT=""
[ -f "$INSTALL_DIR/VERSION" ] && CURRENT="$(cat "$INSTALL_DIR/VERSION")"
if [ "$CURRENT" = "$TAG" ]; then
  success "已是最新版本 $TAG，无需更新。"
  exit 0
fi
[ -n "$CURRENT" ] && info "从 $CURRENT 升级到 $TAG" || info "全新安装 $TAG"

# ══════════════════════════════════════════════════════════════════════════════
# 配置向导（首次安装，升级跳过）
# ══════════════════════════════════════════════════════════════════════════════
ENV_FILE="$INSTALL_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo -e "${BOLD}  DeepTank 配置向导${NC}"
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo ""

  # ── 数据库 ──────────────────────────────────────────────────────────────────
  echo -e "${CYAN}▶ PostgreSQL${NC}"
  SETUP_DB="$(ask "是否由脚本自动安装并初始化 PostgreSQL？[y/n]" "y")"

  if [ "$SETUP_DB" = "y" ] || [ "$SETUP_DB" = "Y" ]; then
    DB_HOST="localhost"
    DB_PORT="5432"
    DB_NAME="deeptank"
    DB_USER="deeptank"
    DB_PASS="$(gen_secret | head -c 24)"
    DB_URL="postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    info "将自动安装 PostgreSQL 并创建数据库 ${DB_NAME}"
  else
    echo "  格式：postgres://用户名:密码@主机:端口/数据库名"
    DB_URL="$(ask "DATABASE_URL" "postgres://deeptank:deeptank@localhost:5432/deeptank")"
    SETUP_DB="n"
  fi
  echo ""

  # ── JWT ─────────────────────────────────────────────────────────────────────
  echo -e "${CYAN}▶ JWT 密钥${NC}"
  echo "  用于签发登录 Token，留空自动生成"
  JWT_RAW="$(ask_secret "JWT_SECRET")"
  [ -z "$JWT_RAW" ] && JWT_RAW="$(gen_secret)" && info "已自动生成 JWT_SECRET"
  echo ""

  # ── 端口 ────────────────────────────────────────────────────────────────────
  echo -e "${CYAN}▶ 引擎监听端口${NC}"
  ENGINE_PORT="$(ask "PORT" "3001")"
  echo ""

  # ── DeepSeek（可选）─────────────────────────────────────────────────────────
  echo -e "${CYAN}▶ DeepSeek API Key（可选，用于 AI 生成坦克外观）${NC}"
  DEEPSEEK_KEY="$(ask_secret "DEEPSEEK_API_KEY")"
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"

  # 写 .env
  mkdir -p "$INSTALL_DIR"
  cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=${DB_URL}
JWT_SECRET=${JWT_RAW}
PORT=${ENGINE_PORT}
ENVEOF
  [ -n "$DEEPSEEK_KEY" ] && echo "DEEPSEEK_API_KEY=${DEEPSEEK_KEY}" >> "$ENV_FILE"
  success ".env 已写入 $ENV_FILE"

else
  info ".env 已存在，跳过配置向导（如需重新配置请删除 $ENV_FILE）"
  SETUP_DB="n"
  ENGINE_PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' ')"
  ENGINE_PORT="${ENGINE_PORT:-3001}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 安装 PostgreSQL（仅在用户选择自动安装时）
# ══════════════════════════════════════════════════════════════════════════════
if [ "${SETUP_DB:-n}" = "y" ] || [ "${SETUP_DB:-n}" = "Y" ]; then
  if command -v psql >/dev/null 2>&1; then
    info "PostgreSQL 已安装，跳过安装步骤"
  else
    info "安装 PostgreSQL..."
    case "$PKG_MANAGER" in
      apt)
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
        ;;
      dnf) dnf install -y postgresql-server postgresql-contrib && postgresql-setup --initdb ;;
      yum) yum install -y postgresql-server postgresql-contrib && postgresql-setup initdb ;;
    esac
    success "PostgreSQL 安装完成"
  fi

  # 确保服务运行
  systemctl enable postgresql
  systemctl start  postgresql
  # 等待就绪（最多 15 秒）
  for i in $(seq 1 15); do
    pg_isready -q && break
    sleep 1
  done
  pg_isready -q || die "PostgreSQL 未能在 15 秒内就绪"
  success "PostgreSQL 已就绪"

  # 创建用户和数据库（幂等）
  info "初始化数据库 ${DB_NAME}..."
  su -s /bin/sh postgres -c "
    psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" \
      | grep -q 1 || psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"
    psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" \
      | grep -q 1 || psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"
  "
  success "数据库 ${DB_NAME} 已就绪（用户：${DB_USER}）"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 下载并安装二进制
# ══════════════════════════════════════════════════════════════════════════════
BIN_URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY_NAME}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "下载 $BINARY_NAME..."
curl -sSfL "$BIN_URL" -o "$TMP/deeptank" || die "下载失败：$BIN_URL"
chmod +x "$TMP/deeptank"

# 停止旧服务
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  info "停止 $SERVICE..."
  systemctl stop "$SERVICE"
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "$TMP/deeptank" "$BIN_PATH"
echo "$TAG" > "$INSTALL_DIR/VERSION"
info "二进制已安装到 $BIN_PATH"

# ── 写 systemd 服务（首次创建，升级不覆盖）──────────────────────────────────
SVC_FILE="/etc/systemd/system/${SERVICE}.service"
if [ ! -f "$SVC_FILE" ]; then
  cat > "$SVC_FILE" <<SVCEOF
[Unit]
Description=DeepTank 引擎（Rust API）
After=network.target postgresql.service

[Service]
Type=simple
User=nobody
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_PATH --serve \${PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF
  info "已创建 $SVC_FILE"
else
  info "$SVC_FILE 已存在，跳过（如需重置：rm $SVC_FILE）"
fi

# ── 启动引擎 ──────────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl start  "$SERVICE"

if systemctl is-active --quiet "$SERVICE"; then
  success "$SERVICE 已启动"
else
  warn "启动失败，查看日志：journalctl -u $SERVICE -n 50"
fi

# ── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  DeepTank $TAG 安装完成！${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo ""
echo "  引擎 API ：http://localhost:${ENGINE_PORT}"
echo "  配置文件 ：$ENV_FILE"
echo ""
echo "  常用命令："
echo "    systemctl status  $SERVICE"
echo "    journalctl -u $SERVICE -f"
echo "    systemctl restart $SERVICE"
echo ""
