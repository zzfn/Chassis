#!/usr/bin/env bash
# DeepTank 一键安装 / 更新脚本（引擎 + 数据库，前端由 Vercel 托管）
# 用法：bash <(curl -sSL https://raw.githubusercontent.com/zzfn/Chassis/main/install.sh)
set -euo pipefail

REPO="zzfn/Chassis"
INSTALL_DIR="/opt/deeptank"
BIN_PATH="/usr/local/bin/deeptank"
SERVICE="deeptank-engine"

# ── 参数解析（支持 --version v0.2.5 或环境变量 VERSION=v0.2.5）────────────────
PINNED_VERSION="${VERSION:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --version|-v) PINNED_VERSION="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deeptank]${NC} $*"; }
success() { echo -e "${GREEN}[deeptank]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deeptank]${NC} $*"; }
die()     { echo -e "${RED}[deeptank] 错误:${NC} $*" >&2; exit 1; }

ask() {
  local prompt="$1" default="${2:-}" var
  if [ -n "$default" ]; then
    printf "${BOLD}%s${NC} [默认: %s]: " "$prompt" "$default" >/dev/tty
  else
    printf "${BOLD}%s${NC}: " "$prompt" >/dev/tty
  fi
  read -r var </dev/tty
  # 去掉首尾空白和 Windows 终端发来的 CR
  var="$(printf '%s' "$var" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  var="${var:-$default}"
  echo "$var"
}

ask_secret() {
  local prompt="$1" var
  printf "${BOLD}%s${NC} (留空自动生成): " "$prompt" >/dev/tty
  read -rs var </dev/tty
  echo "" >/dev/tty
  echo "$var"
}

gen_secret() {
  # dd 读取固定字节后退出 0，避免无限流 + pipefail 导致管道失败
  dd if=/dev/urandom bs=64 count=1 2>/dev/null | base64 | tr -d '\n/+='
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
if [ -n "$PINNED_VERSION" ]; then
  TAG="$PINNED_VERSION"
  info "使用指定版本：$TAG"
else
  info "获取最新版本信息..."
  RELEASE_JSON="$(curl -sSf "https://api.github.com/repos/${REPO}/releases/latest")" \
    || die "无法访问 GitHub API，请检查网络"
  TAG="$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
  [ -n "$TAG" ] || die "未找到任何 Release，请先推送 tag（git tag v1.0.0 && git push --tags）"
fi

# ── 检测当前版本，提示操作选项 ───────────────────────────────────────────────
CURRENT=""
if [ -f "$INSTALL_DIR/VERSION" ]; then CURRENT="$(cat "$INSTALL_DIR/VERSION")"; fi

echo ""
if [ -n "$CURRENT" ]; then
  if [ "$CURRENT" = "$TAG" ]; then
    echo -e "${BOLD}当前版本：${GREEN}$CURRENT${NC}（已是最新）"
    echo ""
    echo "  1) 重新安装（覆盖二进制，保留配置）"
    echo "  2) 退出"
    CHOICE="$(ask "请选择" "2")"
    if [ "$CHOICE" != "1" ]; then
      success "已取消。"
      exit 0
    fi
  else
    echo -e "${BOLD}当前版本：${YELLOW}$CURRENT${NC}  →  最新版本：${GREEN}$TAG${NC}"
    echo ""
    echo "  1) 更新到 $TAG（推荐）"
    echo "  2) 退出"
    CHOICE="$(ask "请选择" "1")"
    if [ "$CHOICE" != "1" ]; then
      success "已取消。"
      exit 0
    fi
    info "从 $CURRENT 升级到 $TAG"
  fi
else
  echo -e "${BOLD}检测到全新安装，版本：${GREEN}$TAG${NC}"
  info "开始全新安装..."
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# 配置向导（首次安装，升级跳过）
# ══════════════════════════════════════════════════════════════════════════════
ENV_FILE="$INSTALL_DIR/.env"
# 防止 set -u 在升级路径（跳过向导）时因未赋值而报错
DB_HOST="" DB_PORT="" DB_NAME="" DB_USER="" DB_PASS="" DB_URL=""

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
    _secret="$(gen_secret)"
    DB_PASS="${_secret:0:24}"
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
  if [ -z "$JWT_RAW" ]; then JWT_RAW="$(gen_secret)"; info "已自动生成 JWT_SECRET"; fi
  echo ""

  # ── 端口 ────────────────────────────────────────────────────────────────────
  echo -e "${CYAN}▶ 引擎监听端口${NC}"
  ENGINE_PORT="$(ask "PORT" "3001")"
  echo ""

  # ── DeepSeek（可选）─────────────────────────────────────────────────────────
  echo -e "${CYAN}▶ DeepSeek API Key（可选，用于 AI 生成坦克外观）${NC}"
  DEEPSEEK_KEY="$(ask_secret "DEEPSEEK_API_KEY")"
  echo ""

  # ── Resend 邮件（可选）──────────────────────────────────────────────────────
  echo -e "${CYAN}▶ Resend 邮件服务（可选，用于注册邮箱验证）${NC}"
  echo "  留空可跳过，验证链接将打印到服务日志，方便本地调试"
  RESEND_KEY="$(ask_secret "RESEND_API_KEY")"
  if [ -n "$RESEND_KEY" ]; then
    APP_URL="$(ask "APP_URL（前端访问地址，验证邮件链接前缀）" "https://deeptank.xyz")"
    FROM_EMAIL="$(ask "FROM_EMAIL（发件人地址，需在 Resend 验证过域名）" "noreply@deeptank.xyz")"
  fi
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"

  # 写 .env
  mkdir -p "$INSTALL_DIR"
  cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=${DB_URL}
JWT_SECRET=${JWT_RAW}
PORT=${ENGINE_PORT}
ENVEOF
  if [ -n "$DEEPSEEK_KEY" ]; then echo "DEEPSEEK_API_KEY=${DEEPSEEK_KEY}" >> "$ENV_FILE"; fi
  if [ -n "${RESEND_KEY:-}" ]; then
    echo "RESEND_API_KEY=${RESEND_KEY}"   >> "$ENV_FILE"
    echo "APP_URL=${APP_URL}"             >> "$ENV_FILE"
    echo "FROM_EMAIL=${FROM_EMAIL}"       >> "$ENV_FILE"
  fi
  success ".env 已写入 $ENV_FILE"

else
  info ".env 已存在，检查必要字段..."
  SETUP_DB="n"

  # 检查 DATABASE_URL
  if ! grep -q '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
    warn "DATABASE_URL 缺失，请填写"
    echo "  格式：postgres://用户名:密码@主机:端口/数据库名"
    _db_url="$(ask "DATABASE_URL" "postgres://deeptank:deeptank@localhost:5432/deeptank")"
    echo "DATABASE_URL=${_db_url}" >> "$ENV_FILE"
    success "DATABASE_URL 已补写"
  fi

  # 检查 JWT_SECRET
  if ! grep -q '^JWT_SECRET=' "$ENV_FILE" 2>/dev/null; then
    warn "JWT_SECRET 缺失，自动生成"
    echo "JWT_SECRET=$(gen_secret)" >> "$ENV_FILE"
    success "JWT_SECRET 已补写"
  fi

  # 检查 PORT
  if ! grep -q '^PORT=' "$ENV_FILE" 2>/dev/null; then
    _port="$(ask "PORT（.env 中缺失）" "3001")"
    echo "PORT=${_port}" >> "$ENV_FILE"
    success "PORT 已补写"
  fi

  ENGINE_PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' ')"
  ENGINE_PORT="${ENGINE_PORT:-3001}"

  # 检查邮件配置（可选）
  _has_resend="$(grep -c '^RESEND_API_KEY=' "$ENV_FILE" 2>/dev/null || true)"
  if [ "${_has_resend}" -gt 0 ]; then
    # 已有 Key，检查配套字段是否完整
    if ! grep -q '^APP_URL=' "$ENV_FILE" 2>/dev/null; then
      warn "APP_URL 缺失（RESEND_API_KEY 已设置）"
      _app_url="$(ask "APP_URL（前端访问地址）" "https://deeptank.xyz")"
      echo "APP_URL=${_app_url}" >> "$ENV_FILE"
      success "APP_URL 已补写"
    fi
    if ! grep -q '^FROM_EMAIL=' "$ENV_FILE" 2>/dev/null; then
      warn "FROM_EMAIL 缺失（RESEND_API_KEY 已设置）"
      _from="$(ask "FROM_EMAIL（发件人地址）" "noreply@deeptank.xyz")"
      echo "FROM_EMAIL=${_from}" >> "$ENV_FILE"
      success "FROM_EMAIL 已补写"
    fi
  else
    # 未配置，询问是否现在设置
    echo -e "${CYAN}▶ Resend 邮件服务（可选）${NC}"
    _setup_mail="$(ask "是否配置邮件服务？[y/n]" "n")"
    if [ "$_setup_mail" = "y" ] || [ "$_setup_mail" = "Y" ]; then
      _resend_key="$(ask_secret "RESEND_API_KEY")"
      if [ -n "$_resend_key" ]; then
        _app_url="$(ask "APP_URL（前端访问地址）" "https://deeptank.xyz")"
        _from="$(ask "FROM_EMAIL（发件人地址）" "noreply@deeptank.xyz")"
        echo "RESEND_API_KEY=${_resend_key}" >> "$ENV_FILE"
        echo "APP_URL=${_app_url}"           >> "$ENV_FILE"
        echo "FROM_EMAIL=${_from}"           >> "$ENV_FILE"
        success "邮件配置已写入"
      fi
    fi
  fi
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
PUBLIC_IP="$(curl -sf --max-time 3 https://checkip.amazonaws.com || \
             curl -sf --max-time 3 https://api.ipify.org || \
             hostname -I 2>/dev/null | awk '{print $1}' || \
             echo "localhost")"
echo "  引擎 API ：http://${PUBLIC_IP}:${ENGINE_PORT}"
echo "  配置文件 ：$ENV_FILE"
echo ""
echo "  常用命令："
echo "    systemctl status  $SERVICE"
echo "    journalctl -u $SERVICE -f"
echo "    systemctl restart $SERVICE"
echo ""
