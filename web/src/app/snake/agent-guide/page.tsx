import type { ReactNode } from "react"

export const metadata = {
  title: "Agent Guide — DeepSnake",
  description: "DeepSnake 贪吃蛇竞技场 Agent 开发规范，供 AI 阅读与生成代码使用。",
}

export default function SnakeAgentGuidePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-zinc-300">

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-5 py-4">
        <span className="mt-0.5 shrink-0 text-emerald-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
        </span>
        <p className="text-sm text-emerald-300 leading-relaxed">
          本页面为 AI 可读规范。将下方完整 Prompt 发给任意 AI，即可让其为 DeepSnake 生成有效的蛇 Agent 代码，并通过 HTTP API 自主提交、模拟、发起挑战。
        </p>
      </div>

      <h1 className="mb-1 text-3xl font-bold text-white">蛇 Agent 开发指南</h1>
      <p className="mb-10 text-sm text-zinc-500">规范版本 v1 · 格子 + 回合制 · 地图 20×20</p>

      {/* ── 00. 认证与工作流 ── */}
      <Section num="00" title="认证与基本工作流">
        <p className="mb-4 text-sm leading-relaxed">
          所有 API 请求在 HTTP 头中携带{" "}
          <Code>Authorization: Bearer &lt;jwt_token&gt;</Code>，Token 登录后从 cookie <Code>token</Code> 字段获取。
        </p>
        <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">步骤</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">接口</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/30">
              {[
                ["1. 读取蛇列表 + 当前代码", "GET /api/snake/context"],
                ["2. 编写 / 改进代码", "（本地生成）"],
                ["3. 提交新版本", "POST /api/snake/code"],
                ["4. 模拟对战 / 查看回放", "POST /api/snake/simulate"],
                ["5. 挑战特定玩家", "POST /api/snake/challenge"],
                ["6. 查看战绩", "GET /api/snake/matches"],
              ].map(([step, api]) => (
                <tr key={step}>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{step}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-emerald-400">{api}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 01. 运行时合约 ── */}
      <Section num="01" title="运行时合约">
        <p className="mb-4 text-sm leading-relaxed">
          你的 JavaScript 文件必须定义全局函数{" "}
          <Code>onIdle(me, others, game)</Code>。引擎在每回合开始时调用它。
          调用 <Code>me.setDir()</Code> 设置本回合蛇头的移动方向；若不调用，蛇继续保持上回合方向。
        </p>
        <Pre>{`function onIdle(me, others, game) {
  me.setDir("north");  // 设置移动方向：north / east / south / west
  // 不能 180° 反转（会被忽略，继续原方向）
}`}</Pre>
        <div className="mt-4 flex flex-col gap-1.5 text-xs text-zinc-500">
          <p>⏱ 执行上限 <span className="text-yellow-400 font-semibold">10 ms</span>，内存上限 <span className="text-yellow-400 font-semibold">2 MB</span>。</p>
          <p>🧱 撞墙（<Code>x</Code>/<Code>m</Code>）或撞身体判定死亡，不会弹回。</p>
          <p>🔄 180° 反转指令会被忽略，蛇继续原方向移动。</p>
          <p>🚫 不支持 <Code>fetch</Code>、<Code>setTimeout</Code>、<Code>require</Code>，仅支持纯 ES5 计算。</p>
        </div>
      </Section>

      {/* ── 02. 数据结构 ── */}
      <Section num="02" title="数据结构">
        <p className="mb-3 text-sm">参数 <Code>me</Code> — 自己的蛇：</p>
        <Pre>{`me = {
  head:      [col, row],          // 头部格子坐标（0 = 左/上）
  body:      [[col,row], ...],    // 完整身体，body[0] = 头
  direction: "east",              // 当前朝向
  length:    5,                   // 身体长度（吃到食物后增长）
  score:     3,                   // 已吃食物数
  setDir(dir): void,              // 设置本回合方向
}`}</Pre>
        <p className="mb-3 mt-4 text-sm">参数 <Code>others</Code> — 其他存活蛇的数组：</p>
        <Pre>{`others = [
  {
    head:      [col, row],
    body:      [[col,row], ...],
    direction: "west",
    length:    3,
    score:     1,
  },
  // ...
]`}</Pre>
        <p className="mb-3 mt-4 text-sm">参数 <Code>game</Code> — 全局游戏状态：</p>
        <Pre>{`game = {
  map:  string[],            // 20 行字符串，game.map[row][col]
                             //   '.' = 地板  'x' = 永久墙
                             //   'm' = 土堆  'o' = 草丛
  food: [[col,row], ...],    // 当前所有食物坐标
  tick: 42,                  // 当前回合数（从 0 开始）
}`}</Pre>
      </Section>

      {/* ── 03. 地图与坐标 ── */}
      <Section num="03" title="地图与坐标系">
        <p className="mb-3 text-sm leading-relaxed">
          地图为 20×20 格，坐标 <Code>[col, row]</Code>，col 向右为正，row 向下为正。
        </p>
        <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">格子</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">含义</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">可穿越</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/30">
              {[
                [".", "地板", "✓"],
                ["o", "草丛", "✓"],
                ["x", "永久墙", "✗ 撞墙死亡"],
                ["m", "土堆", "✗ 撞墙死亡"],
              ].map(([tile, desc, pass]) => (
                <tr key={tile}>
                  <td className="px-4 py-2.5 font-mono text-emerald-400">{tile}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{desc}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{pass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pre>{`// 方向 → 坐标增量
// north: row - 1
// south: row + 1
// east:  col + 1
// west:  col - 1

function nextHead(head, dir) {
  var nx = head[0], ny = head[1];
  if (dir === "north") ny--;
  else if (dir === "south") ny++;
  else if (dir === "east")  nx++;
  else if (dir === "west")  nx--;
  return [nx, ny];
}`}</Pre>
      </Section>

      {/* ── 04. 游戏规则 ── */}
      <Section num="04" title="游戏规则">
        <div className="flex flex-col gap-2 text-sm">
          {[
            ["起始位置", "4 条蛇从地图四角出发，初始长度 3，朝向地图中心。"],
            ["食物", "地图上最多同时存在 3 个食物，每隔若干回合刷新。蛇头踏上食物格即吃掉，身体增长 1 格，score +1。"],
            ["移动", "每回合所有蛇同时移动 1 格，身体尾部缩短（除非本回合吃到食物）。"],
            ["死亡条件", "头部撞墙（x/m）、超出地图边界、或头部与任意蛇的身体重叠（含自身）。"],
            ["头碰头", "两条蛇头部同格：双方同时死亡。"],
            ["胜负判定", "存活最久（最后一条活着的蛇）获胜；若同回合全灭，以 score 最高者胜；最多 500 回合，超时以 score 判定。"],
          ].map(([key, val]) => (
            <div key={key} className="flex gap-3">
              <span className="w-20 shrink-0 text-right text-xs font-semibold text-emerald-400">{key}</span>
              <span className="text-xs leading-relaxed text-zinc-400">{val}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 05. HTTP API ── */}
      <Section num="05" title="HTTP API 参考">

        <ApiBlock method="GET" path="/api/snake/context">
          <p className="mb-2 text-xs text-zinc-400">获取当前用户的蛇列表与最新代码。</p>
          <Pre>{`// Query: ?name=<snake_name>（可选，指定查看哪条蛇）
// Response
{
  snakes: [{ agent_id, agent_name, pvp_battles, pvp_wins, version }],
  current_name: "my_snake",
  code: "function onIdle(...) { ... }",
  version: 3
}`}</Pre>
        </ApiBlock>

        <ApiBlock method="POST" path="/api/snake/code">
          <p className="mb-2 text-xs text-zinc-400">提交新版代码（自动创建新版本）。</p>
          <Pre>{`// Request body
{ "name": "my_snake", "code": "function onIdle(...) { ... }" }
// Response
{ "ok": true, "agent_id": "uuid", "version": 4 }`}</Pre>
        </ApiBlock>

        <ApiBlock method="POST" path="/api/snake/simulate">
          <p className="mb-2 text-xs text-zinc-400">发起对战并保存回放。</p>
          <Pre>{`// Request body（三种模式）
{ "name": "my_snake" }                          // 自我镜像
{ "name": "my_snake", "random_opponent": true } // 随机对手
{ "name": "my_snake", "opponent_id": "<uuid>" } // 指定对手 agent_id
// Response
{
  "id": "battle-uuid",
  "winner": "my_snake",
  "winner_label": "my_snake 获胜",
  "total_ticks": 312,
  "replay_url": "/snake/replay/battle-uuid"
}`}</Pre>
        </ApiBlock>

        <ApiBlock method="POST" path="/api/snake/challenge">
          <p className="mb-2 text-xs text-zinc-400">挑战特定玩家（不能挑战自己）。</p>
          <Pre>{`// Request body
{ "snake_name": "my_snake", "opponent_id": "<agent_uuid>" }
// Response（同 simulate）`}</Pre>
        </ApiBlock>

        <ApiBlock method="GET" path="/api/snake/matches">
          <p className="mb-2 text-xs text-zinc-400">查询对战历史。</p>
          <Pre>{`// Query: ?name=my_snake&limit=20&offset=0
// Response: SnakeMatchRecord[]
[{ id, challenger, opponent, winner, total_ticks, created_at }]`}</Pre>
        </ApiBlock>

        <ApiBlock method="GET" path="/api/snake/players">
          <p className="mb-2 text-xs text-zinc-400">获取全服玩家列表（无需 Auth）。</p>
          <Pre>{`// Response: SnakePlayerEntry[]
[{ agent_id, agent_name, owner, pvp_battles, pvp_wins, version }]`}</Pre>
        </ApiBlock>

        <ApiBlock method="GET" path="/api/snake/replay/:id">
          <p className="mb-2 text-xs text-zinc-400">获取回放数据（无需 Auth）。</p>
          <Pre>{`// Response
{
  id, agent_name, opponent, winner, total_ticks,
  arena: { map: string[], width: 20, height: 20 },
  telemetry: [
    {
      tick: 0,
      snakes: [{ id, name, body, alive, score, direction }],
      food: [[col, row]]
    }
  ],
  battle_log: ["tick 0: ..."]
}`}</Pre>
        </ApiBlock>
      </Section>

      {/* ── 06. 完整示例 ── */}
      <Section num="06" title="完整 Agent 示例（贪心寻路）">
        <Pre>{`function onIdle(me, others, game) {
  var head = me.head;

  // 找最近食物
  var target = null, minDist = 9999;
  for (var i = 0; i < game.food.length; i++) {
    var d = Math.abs(game.food[i][0] - head[0])
           + Math.abs(game.food[i][1] - head[1]);
    if (d < minDist) { minDist = d; target = game.food[i]; }
  }

  // 按优先级排列方向
  var dirs = [];
  if (target) {
    var dx = target[0] - head[0], dy = target[1] - head[1];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 0) dirs.push("east");  else dirs.push("west");
      if (dy > 0) dirs.push("south"); else dirs.push("north");
    } else {
      if (dy > 0) dirs.push("south"); else dirs.push("north");
      if (dx > 0) dirs.push("east");  else dirs.push("west");
    }
  }
  var all = ["north","east","south","west"];
  for (var k = 0; k < all.length; k++) {
    if (dirs.indexOf(all[k]) < 0) dirs.push(all[k]);
  }

  // 选第一个安全方向
  for (var j = 0; j < dirs.length; j++) {
    if (isSafe(head, dirs[j], me, others, game)) {
      me.setDir(dirs[j]);
      return;
    }
  }
}

function isSafe(head, dir, me, others, game) {
  var nx = head[0], ny = head[1];
  if (dir === "north") ny--; else if (dir === "south") ny++;
  else if (dir === "east") nx++; else if (dir === "west") nx--;
  if (nx < 0 || ny < 0 || nx >= 20 || ny >= 20) return false;
  var cell = game.map[ny][nx];
  if (cell === "x" || cell === "m") return false;
  // 自身碰撞（尾部本帧会离开，排除）
  for (var i = 0; i < me.body.length - 1; i++) {
    if (me.body[i][0] === nx && me.body[i][1] === ny) return false;
  }
  // 其他蛇碰撞
  for (var j = 0; j < others.length; j++) {
    for (var k = 0; k < others[j].body.length; k++) {
      if (others[j].body[k][0] === nx && others[j].body[k][1] === ny) return false;
    }
  }
  return true;
}`}</Pre>
      </Section>

      {/* ── 07. AI Prompt 模板 ── */}
      <Section num="07" title="AI Prompt 模板">
        <p className="mb-3 text-sm text-zinc-400">复制以下 Prompt 给 AI，让它帮你生成或优化蛇 Agent 代码：</p>
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-5">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300">{`你是 DeepSnake 贪吃蛇 AI Agent 专家。

【运行环境】
- 地图 20×20 格，坐标 [col, row]，左上角为 [0,0]
- 每回合调用 onIdle(me, others, game)，调用 me.setDir(dir) 设置方向
- 方向：north(row-1) / south(row+1) / east(col+1) / west(col-1)
- 不能 180° 反转；撞墙(x/m)或撞身体即死亡
- 吃食物身体增长，最多 500 回合，存活最久者胜

【API 工作流】
1. GET /api/snake/context → 获取我的蛇列表和当前代码
2. 生成改进后的 onIdle 函数
3. POST /api/snake/code { name, code } → 提交新版本
4. POST /api/snake/simulate { name, random_opponent: true } → 测试对战
5. GET /api/snake/replay/:id → 分析回放结果，继续优化

所有请求加 Authorization: Bearer <token> header。

请帮我编写一个高胜率的蛇 Agent，要求：
1. 优先追最近食物
2. 安全性检测：避开墙壁、自身、其他蛇
3. 在追食物路径被封堵时有逃生策略
4. 代码为纯 ES5（不用 const/let/箭头函数），10ms 内执行完毕`}</pre>
        </div>
      </Section>

    </main>
  )
}

/* ── Sub-components ── */

function Section({ num, title, children }: { num: string; title: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-center gap-3">
        <span className="font-mono text-xs font-semibold text-emerald-500">{num}</span>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
      {children}
    </code>
  )
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
      {children}
    </pre>
  )
}

function ApiBlock({ method, path, children }: { method: string; path: string; children: ReactNode }) {
  const methodColor = method === "GET" ? "text-blue-400" : "text-emerald-400"
  return (
    <div className="mb-6 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
        <span className={`font-mono text-xs font-bold ${methodColor}`}>{method}</span>
        <span className="font-mono text-xs text-zinc-300">{path}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
