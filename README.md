# Chassis — 坦克竞技场仿真引擎

用 JavaScript 编写 AI 坦克 agent，在 20×20 格子地图上进行回合制对战。Rust 引擎在 QuickJS 沙箱中执行 JS 代码，输出逐帧遥测数据供 Next.js 前端实时回放。

## 快速开始

### 环境要求

- Rust 1.75+
- Node.js 18+
- PostgreSQL 15+

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd chassis

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL 和 JWT_SECRET

# 同时启动引擎和前端
make dev
```

前端访问 http://localhost:3000，API 监听 http://localhost:3001。

## 编写你的第一个 Agent

在 `agents/` 目录下创建 `.js` 文件，实现 `onIdle` 函数：

```js
function onIdle(me, enemy, game) {
  // me.tank.position  → [col, row]，tile 坐标（0 = 左/上）
  // me.tank.facing    → "north" | "east" | "south" | "west"
  // me.tank.hp        → 当前血量（初始 100）
  // me.tank.shootCooldown → 0 表示可以射击

  if (enemy) {
    me.fire();          // 射击
  } else {
    me.go();            // 前进 1 格
    me.turn("right");   // 右转 90°
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

## 运行对战

```bash
# 所有 agents/ 下的 .js 互相对战
cargo run

# 指定参赛坦克
cargo run -- agents/rusher.js agents/sniper.js

# 启动 HTTP API 服务器
cargo run -- --serve          # 默认端口 3001
cargo run -- --serve 3002     # 自定义端口
```

## HTTP API

### 发起对战

```http
POST /api/battle
Content-Type: application/json

{
  "name": "my_tank",
  "code": "function onIdle(me, enemy, game) { me.fire(); me.go(); }",
  "opponent": "rusher"
}
```

返回完整 `BattleResult`（`winner`、`total_ticks`、`telemetry` 帧数据等）。

内置 bot：`rusher`（冲锋者）、`circler`（侧翼手）、`sniper`（狙击手）、`camper`（守门员）。

### 其他端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/register` | 注册账号 |
| `POST` | `/api/login` | 登录，返回 JWT |
| `GET/POST` | `/api/agent` | 获取/提交坦克代码（API Key）|
| `GET` | `/api/agent/tank` | 获取坦克上下文（Elo、战绩）|
| `POST` | `/api/agent/tank/challenge` | 发起 PvP 挑战 |
| `POST` | `/api/agent/tank/simulate` | 模拟对战（不计战绩）|
| `GET` | `/api/agent/leaderboard` | 排行榜 |
| `GET` | `/api/replay/:id` | 获取对战回放 |

## 游戏规则

- **地图**：20×20 tile，每 tile = 40 虚拟像素
- **回合上限**：300 回合
- **初始血量**：100 HP
- **子弹伤害**：25 HP / 发
- **射击冷却**：3 回合
- **子弹速度**：1 tile / 回合
- **星星**：每 30 回合刷新 1 颗（最多 3 颗），拾取得 1 分
- **胜负**：最后存活者胜；血量归零即淘汰

## 项目结构

```
chassis/
├── agents/          # 内置 bot JS 文件
├── src/
│   ├── main.rs      # 入口（CLI 解析）
│   ├── physics.rs   # 格子物理类型与纯函数
│   ├── battle.rs    # ArenaEngine 主仿真循环
│   ├── sandbox.rs   # QuickJS 沙箱
│   ├── db.rs        # PostgreSQL 数据访问
│   ├── auth.rs      # JWT + Argon2 认证
│   └── server/      # Axum HTTP 服务器
│       ├── mod.rs   # AppState、共享辅助、serve()
│       └── routes/
│           ├── battle.rs
│           ├── auth.rs
│           ├── tank.rs
│           └── agent.rs
└── web/             # Next.js 前端
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgres://chassis:chassis@localhost:5432/chassis` | PostgreSQL 连接串 |
| `JWT_SECRET` | `chassis-secret` | JWT 签名密钥 |
| `DEEPSEEK_API_KEY` | — | AI 生成坦克皮肤（可选）|

## 开发命令

```bash
cargo build --release   # 构建生产版本
cargo test              # 运行测试
cd web && npm run build # 构建前端
cd web && npm run lint  # 前端 lint
```
