# DeepTank — 坦克竞技场仿真引擎

用 JavaScript 编写 AI 坦克 agent，在 20×20 格子地图上进行回合制对战。Rust 引擎在 QuickJS 沙箱中执行 JS 代码，输出逐帧遥测数据供 Next.js 前端实时回放。

## 服务器安装（一键）

```bash
curl -sSL https://raw.githubusercontent.com/zzfn/Chassis/main/install.sh | bash
```

脚本会交互式询问数据库、JWT 密钥、端口等配置，自动安装 PostgreSQL 并注册 systemd 服务。**升级时重新执行同一命令即可**，已有 `.env` 不会被覆盖。

> 仅支持 Linux（Debian/Ubuntu/RHEL/CentOS），需要 root 权限。

## Release 产物

每次推送 `v*.*.*` tag 后，GitHub Actions 自动构建并发布到 [Releases](https://github.com/zzfn/Chassis/releases)：

| 文件 | 说明 |
|------|------|
| `deeptank-linux-amd64` | x86_64 Linux 二进制 |
| `deeptank-linux-arm64` | ARM64 Linux 二进制（AWS Graviton / Oracle Ampere）|

```bash
# 手动触发 Release
git tag v1.0.0 && git push --tags
```

---

## 本地开发

### 环境要求

- Rust 1.75+
- Node.js 20+
- PostgreSQL 16+

### 启动

```bash
# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL 和 JWT_SECRET

# 同时启动引擎（:3001）和前端（:3000）
make dev
```

## 编写你的第一个 Agent

在 `agents/` 目录下创建 `.js` 文件，实现 `onIdle` 函数：

```js
function onIdle(me, enemy, game) {
  // me.tank.position     → [col, row]，tile 坐标（0 = 左/上）
  // me.tank.direction    → "north" | "east" | "south" | "west"
  // me.tank.hp           → 当前血量（初始 100）
  // me.tank.shootCooldown → 0 表示可以射击
  // enemy?.tank          → 最近存活敌人，null 表示无敌
  // game.map             → string[]，game.map[row][col] 判断格子类型
  // game.stars           → [[col,row], ...]
  // game.frames          → 当前回合数

  if (enemy) {
    me.fire();
  } else {
    me.go();
    me.turn("right");
  }
}
```

### Agent 接口

| 方法 | 说明 |
|------|------|
| `me.go(n?)` | 前进 n 格（默认 1，最多 10）|
| `me.turn("left" \| "right")` | 左/右转 90° |
| `me.fire()` | 射击（冷却中自动跳过）|
| `print(msg)` | 写入 battle_log |

### 地图符号

| 符号 | 说明 |
|------|------|
| `.` | 地板（可通行）|
| `x` | 永久墙（不可通行，阻挡子弹）|
| `m` | 土堆（不可通行，1 发摧毁）|
| `o` | 草丛（可通行，不阻挡子弹）|

## HTTP API

### 发起对战

```http
POST /api/battle
Content-Type: application/json

{
  "name": "my_tank",
  "code": "function onIdle(me, enemy, game) { me.fire(); me.go(); }",
  "opponent": "enemy_tank",
  "opponent_code": "function onIdle(me, enemy, game) { me.go(); }"
}
```

返回完整 `BattleResult`（`winner`、`total_ticks`、`telemetry` 帧数据等）。

### 其他端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/register` | 注册账号 |
| `POST` | `/api/login` | 登录，返回 JWT |
| `GET/POST` | `/api/agent` | 获取/提交坦克代码（API Key）|
| `GET` | `/api/agent/tank` | 获取坦克上下文（Elo、战绩）|
| `POST` | `/api/agent/tank/simulate` | 模拟自战（不计战绩，用于调试）|
| `POST` | `/api/agent/tank/challenge` | 发起 PvP 挑战 |
| `GET` | `/api/agent/leaderboard` | 排行榜 |
| `GET` | `/api/replay/:id` | 获取对战回放 |

## 游戏规则

- **地图**：20×20 tile，每 tile = 40 虚拟像素
- **回合上限**：300 回合
- **初始血量**：100 HP
- **子弹伤害**：25 HP / 发
- **射击冷却**：3 回合
- **子弹速度**：2 tile / 回合
- **星星**：每 30 回合刷新 1 颗（最多 3 颗），拾取得 1 分
- **胜负**：最后存活者胜；血量归零即淘汰

## 项目结构

```
deeptank/
├── install.sh       # 一键安装脚本
├── agents/          # 示例 bot JS 文件
├── src/
│   ├── main.rs      # 入口（CLI 解析）
│   ├── physics.rs   # 格子物理类型与纯函数
│   ├── battle.rs    # ArenaEngine 主仿真循环
│   ├── sandbox.rs   # QuickJS 沙箱
│   ├── db.rs        # PostgreSQL 数据访问
│   ├── auth.rs      # JWT + Argon2 认证
│   └── server/      # Axum HTTP 服务器
│       ├── mod.rs
│       └── routes/
│           ├── battle.rs
│           ├── auth.rs
│           ├── tank.rs
│           └── agent.rs
└── web/             # Next.js 前端（Vercel 部署）
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgres://deeptank:deeptank@localhost:5432/deeptank` | PostgreSQL 连接串 |
| `JWT_SECRET` | `deeptank-secret` | JWT 签名密钥（生产环境必须修改）|
| `PORT` | `3001` | 引擎监听端口 |
| `DEEPSEEK_API_KEY` | — | AI 生成坦克皮肤（可选）|

## 开发命令

```bash
cargo build --release   # 构建生产版本
cargo test              # 运行测试
cd web && npm run dev   # 前端开发服务器
cd web && npm run build # 前端构建
```
