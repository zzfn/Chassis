# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

\*\*DeepTank\*\* 是一个坦克竞技场仿真引擎：用户用 JavaScript 编写 AI 坦克 agent，Rust 引擎在 QuickJS 沙箱中执行 JS，输出逐帧遥测数据供 Next.js 前端回放。

## 常用命令

### Rust 引擎（根目录）

```bash
cargo run                          # 运行 agents/ 目录下所有 .js
cargo run -- agents/rusher.js      # 指定参赛坦克
cargo run -- --serve               # 启动 HTTP API（默认端口 3001）
cargo run -- --serve 3002          # 指定端口
cargo build --release
cargo test
```

### Next.js 前端（web/ 目录）

```bash
cd web && npm run dev              # 开发服务器 http://localhost:3000
cd web && npm run build
cd web && npm run lint
```

## 架构说明

### 仿真模型：格子 + 回合制

- **地图**：20×20 tile，每 tile = 40 虚拟像素（总世界坐标 800×800）
- **Tile 类型**：`.` 地板 / `x` 永久墙 / `m` 可破坏土堆（1 发摧毁）/ `o` 草丛
- **朝向**：4 向 North/East/South/West，转向固定 90°
- **回合模型（队列延迟）**：`onIdle` 仅在命令队列为空时被调用，排队的命令逐帧（每回合 1 条）消费
- **弹速**：1 tile/回合；**伤害**：25 HP/发；**冷却**：3 回合；**最大回合**：300
- **遥测坐标**：`TankSnapshot.x/y` = `tile * 40 + 20`（像素中心），`body_angle` = Facing 对应弧度

每回合执行顺序：
1. 所有坦克冷却递减
2. 星星刷新（每 30 回合刷 1 颗，最多 3 颗）
3. 队列为空的坦克调用 `onIdle` → 填充命令队列
4. 每辆坦克 pop 队首命令执行（Move/TurnLeft/TurnRight/Fire）
5. 所有子弹前进 1 格，处理碰撞
6. 捡星星检测
7. 记录遥测帧 / 胜负判断

### Rust 引擎（`src/`）

四个模块职责明确：

- **`battle.rs`** — `ArenaEngine`：主仿真循环（回合制，最多 300 回合）。返回 `BattleResult`（含 `telemetry`、`battle_log`、`winner`）。`ArenaConfig.map` 为 `Vec<String>`（20 行字符串）。
- **`physics.rs`** — 格子物理类型与纯函数：`Tile`、`Facing`、`TankCommand`、`TankState`（含 `command_queue: VecDeque<TankCommand>`）、`SensorData`、`init_map()`、`start_positions()`、`compute_sensors()`、`step_forward()`。
- **`sandbox.rs`** — `QuickJsSandbox`：每个坦克一个 QuickJS 实例。初始化时预执行 `INFRA_JS`（定义 `__queue`、`me.go/turn/fire`、`print`）再执行用户代码。`act(&self, sensors) -> (Vec<TankCommand>, Vec<String>)`：重置队列 → 更新 `me.tank`/`enemy`/`game` → 调用 `onIdle(me, enemy, game)` → 读取 `__queue`。硬限制：10ms / 2MB。
- **`server.rs`** — Axum HTTP 服务器，`POST /api/battle`，请求体 `{name, code}`，内置三个陪练 bot（rusher、circler、sniper），`include_str!` 嵌入。

### JS Agent 接口（`agents/*.js`）

每个 JS 文件必须定义 `onIdle(me, enemy, game)` 函数：

```js
function onIdle(me, enemy, game) {
  // me.tank = {
  //   position: [col, row],  // tile 坐标，0=左/上
  //   direction: "east",     // "north" | "east" | "south" | "west"
  //   hp: 100,
  //   score: 0,
  //   shootCooldown: 0,      // 0 = 可射击
  // }
  // enemy = null | { tank: { position, direction, hp } }  最近存活敌人
  // game  = { map: string[], stars: [[col,row],...], star: [col,row]|null, frames: number }

  me.go();          // 前进 1 格（可选参数 n，最多 10）
  me.turn("left");  // 左转 90°
  me.turn("right"); // 右转 90°
  me.fire();        // 朝当前朝向射击（冷却中自动跳过）
  print("debug");   // 写入 battle_log
}
```

- 函数执行上限 **10ms**，内存上限 **2MB**，仅支持纯 ES5（无 `fetch`/`setTimeout`/`require`）。
- 撞墙时 Move 命令无效（不动，不报错）。
- `game.map[row][col]` 可判断格子类型用于寻路。

### HTTP API

`POST http://localhost:3001/api/battle`

```json
{ "name": "my_tank", "code": "function onIdle(me, enemy, game) { ... }" }
```

返回完整 `BattleResult`：`winner`、`total_ticks`、`arena`（含 `map: string[]`）、`telemetry`（`FrameData[]`）、`battle_log`。HTTP 模式下你的坦克固定对战内置的 rusher、circler、sniper 三个 bot。

### Next.js 前端（`web/`）

- **Next.js 16 + React 19**：此版本有 breaking changes，修改前先阅读 `node_modules/next/dist/docs/` 中对应指南。
- 页面路由：`/`（主页）、`/race`（代码编辑器 + 对战）、`/replay/[id]`（逐帧回放）、`/dashboard`（排行榜）、`/login`
- UI：Tailwind CSS v4、shadcn/ui（组件在 `components/ui/`）、Monaco Editor（代码编辑）、@base-ui/react
- 前端通过 `POST /api/battle` 调用 Rust 引擎，遥测数据在客户端渲染为动画回放。
