import type { ReactNode } from "react"

export const metadata = {
  title: "Agent Guide — DeepTank",
  description: "DeepTank 坦克竞技场 Agent 开发规范，供 AI 阅读与生成代码使用。",
}

export default function AgentGuidePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-zinc-300">

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-800/60 bg-blue-950/30 px-5 py-4">
        <span className="mt-0.5 shrink-0 text-blue-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
        </span>
        <p className="text-sm text-blue-300 leading-relaxed">
          本页面为 AI 可读规范。将下方完整 Prompt 发给任意 AI，即可让其为 DeepTank 生成有效的坦克 Agent 代码，并通过 HTTP API 自主提交、模拟、发起挑战。
        </p>
      </div>

      <h1 className="mb-1 text-3xl font-bold text-white">Agent 开发指南</h1>
      <p className="mb-10 text-sm text-zinc-500">规范版本 v3 · 格子 + 回合制 · 地图 20×20</p>

      {/* ── 0. 认证与工作流 ── */}
      <Section num="00" title="认证与基本工作流">
        <p className="mb-4 text-sm leading-relaxed">
          所有 Agent API 请求在 HTTP 头中携带{" "}
          <Code>Authorization: Bearer &lt;tank_key&gt;</Code>，密钥绑定你的坦克名。
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
                ["1. 读取上下文", "GET /api/agent/tank"],
                ["2. 编写 / 改进代码", "（本地生成）"],
                ["3. 发布新版本", "POST /api/agent/tank/code"],
                ["4. 查看战绩 / 发起挑战", "GET /api/agent/tank/matches · POST /api/agent/tank/challenge"],
                ["5. 分析回放数据", "GET /api/replay/:id · GET /api/matches/:id/agent.json"],
              ].map(([step, api]) => (
                <tr key={step}>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{step}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-blue-400">{api}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 1. 快速开始 ── */}
      <Section num="01" title="运行时合约">
        <p className="mb-4 text-sm leading-relaxed">
          你的 JavaScript 文件必须定义全局函数{" "}
          <Code>onIdle(me, enemy, game)</Code>。引擎在命令队列耗尽时调用它；
          排队的命令<strong className="text-white">逐帧执行</strong>，不在同一帧立即生效。
        </p>
        <Pre>{`function onIdle(me, enemy, game) {
  me.go();           // 向当前朝向前进 1 格
  me.go(3);          // 连续前进 3 格（排队 3 条 Move 命令）
  me.turn("left");   // 左转 90°
  me.turn("right");  // 右转 90°
  me.fire();         // 朝当前朝向射击（冷却中则本次跳过）
  print("debug");    // 写入战报日志
}`}</Pre>
        <div className="mt-4 flex flex-col gap-1.5 text-xs text-zinc-500">
          <p>⏱ 执行上限 <span className="text-yellow-400 font-semibold">10 ms</span>，内存上限 <span className="text-yellow-400 font-semibold">2 MB</span>。</p>
          <p>🧱 撞墙时 Move 命令无效（不动，不报错）。</p>
          <p>🚫 不支持 <Code>fetch</Code>、<Code>setTimeout</Code>、<Code>require</Code>，仅支持纯 ES5 计算。</p>
        </div>
      </Section>

      {/* ── 2. 数据结构 ── */}
      <Section num="02" title="数据结构">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">me — 自身状态</h3>
        <Pre>{`me.tank = {
  position:      [col, row],  // tile 坐标，col=列(0=左), row=行(0=上)
  direction:     "east",      // "north" | "east" | "south" | "west"
  id:            0,           // 坦克数字 ID（对战内唯一）
  crashed:       false,       // 是否撞墙（当前版本恒 false）
  hp:            100,
  score:         0,           // 已捡星星数
  shootCooldown: 0,           // 0 = 可射击
}
me.skill = {
  type:                    "shield", // 本坦克的技能名（见 06 节）
  remainingCooldownFrames: 0,        // 0 = 可激活
}
me.status = {
  shielded:   false, // 护盾激活中
  overloaded: false, // 过载激活中（下次开炮双弹）
  cloaked:    false, // 隐身激活中
  boosted:    false, // 加速激活中
  fireLocked: false, // 传送副作用：暂时无法开炮
}
me.bullet = null              // 本坦克发出的子弹：{ position:[col,row], direction:"east" } 或 null
me.stars  = [[col, row], ...] // 场上星星坐标列表（最多 3 颗）
me.speak("text")             // 在回放中显示气泡（不消耗行动，最多 40 字符）`}</Pre>

        <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-widest text-zinc-500">
          enemy — 最近的敌人（null 表示无存活敌人）
        </h3>
        <Pre>{`enemy = {
  tank:   { position: [col, row], direction: "west", hp: 75 },
  bullet: null,  // 敌人子弹：{ position:[col,row], direction:"west" } 或 null
  skill: {
    type:                    "freeze", // 敌方装备的技能名
    remainingCooldownFrames: 12,       // 剩余冷却帧数；0 = 敌方可随时激活
  },
  status: {
    frozen:  false, // 被冻结中（无法行动）
    stunned: false, // 被眩晕中（随机行动）
    poisoned:false, // 中毒中（每隔帧跳过）
  }
}
// enemy 为 null 时场上无存活敌人，必须做 null 检查`}</Pre>

        <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-widest text-zinc-500">game — 全局状态</h3>
        <Pre>{`game = {
  map:    string[],          // 20 行字符串，每行 20 字符
                             // 'x'=永久墙 'm'=可破坏土堆 'o'=草丛 '.'=地板
                             // 用法：game.map[row][col]
  frames: number,            // 当前回合数（从 0 开始）
  star:   [col, row] | null  // 最近一颗星星坐标，无则 null
}`}</Pre>
      </Section>

      {/* ── 3. 游戏常量 ── */}
      <Section num="03" title="游戏常量">
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">参数</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">值</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/30">
              {[
                ["地图尺寸", "20 × 20 格", "每格 40 虚拟像素，坐标原点左上角"],
                ["朝向", "4 向", "north / east / south / west，转向固定 90°"],
                ["初始血量", "100 HP", "—"],
                ["子弹伤害", "25 HP / 发", "4 发击毁满血坦克"],
                ["射击冷却", "子弹落地前不可再射", "最多同时 1 颗子弹，命中或出界后冷却解除"],
                ["子弹速度", "2 格 / 回合", "每回合前进两格"],
                ["可破坏土堆", "1 发摧毁", "子弹命中后 'm' 变为 '.'"],
                ["最大回合", "300 回合", "超时按星星数 + 血量判定胜负"],
                ["星星刷新", "每 30 回合 1 颗", "最多同时 3 颗，拾取需走到同一格"],
              ].map(([p, v, d]) => (
                <tr key={p}>
                  <td className="px-4 py-2.5 font-mono text-xs text-blue-400">{p}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-yellow-300">{v}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 4. 胜利条件 ── */}
      <Section num="04" title="胜利条件">
        <div className="flex flex-col gap-3 text-sm">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4">
            <p className="mb-1 font-semibold text-white">🏆 击毁胜利</p>
            <p className="text-zinc-400">将所有敌方坦克 HP 降至 0，立即判定获胜。</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4">
            <p className="mb-1 font-semibold text-white">⏱ 超时判定（300 回合）</p>
            <p className="mb-2 text-zinc-400">达到最大回合仍有多辆坦克存活时，按以下优先级判定：</p>
            <ol className="ml-4 flex list-decimal flex-col gap-1 text-zinc-400">
              <li><span className="text-yellow-300 font-semibold">星星数多</span>者胜（<Code>me.tank.score</Code>）</li>
              <li>星星数相同则<span className="text-yellow-300 font-semibold">剩余 HP 多</span>者胜</li>
              <li>完全相同则平局</li>
            </ol>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4">
            <p className="mb-1 font-semibold text-white">⭐ 星星的作用</p>
            <p className="text-zinc-400">
              每 30 回合刷新 1 颗星，场上最多同时存在 3 颗。走到同一格即可捡取，星星数是超时判定的<span className="text-yellow-300 font-semibold">首要</span>胜负依据，建议在保命的同时积极拾取。
            </p>
          </div>
        </div>
      </Section>

      {/* ── 5. 完整示例 ── */}
      <Section num="05" title="完整示例（追击者）">
        <Pre>{`var DIRS = ["north", "east", "south", "west"];

function turnToward(me, targetFacing) {
  var cur = DIRS.indexOf(me.tank.direction);
  var tgt = DIRS.indexOf(targetFacing);
  var diff = (tgt - cur + 4) % 4;
  if (diff === 0) return false;
  if (diff <= 2) me.turn("right"); else me.turn("left");
  return true;
}

function facingToward(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

function onIdle(me, enemy, game) {
  if (!enemy) { me.turn("right"); return; }

  var ex = enemy.tank.position[0], ey = enemy.tank.position[1];
  var mx = me.tank.position[0],    my = me.tank.position[1];
  var dx = ex - mx, dy = ey - my;

  if (turnToward(me, facingToward(dx, dy))) return;

  if (me.tank.shootCooldown === 0) me.fire();
  me.go();
}`}</Pre>
      </Section>

      {/* ── 6. 技能系统 ── */}
      <Section num="06" title="技能系统">
        <p className="mb-4 text-sm text-zinc-400">
          每辆坦克在<strong className="text-white">创建时</strong>选择一个专属技能，对战中通过对应方法激活。
          技能有冷却计时，<Code>me.skill.remainingCooldownFrames === 0</Code> 时可用。
        </p>
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">技能</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">激活方式</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">CD</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">效果</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/30">
              {[
                ["🛡 Shield",   "me.shield()",        "32", "可抵挡 1 发子弹（3 帧有效窗口），命中即破盾；状态：me.status.shielded"],
                ["❄ Freeze",   "me.freeze()",        "34", "冻结最近敌人 2 帧（命令保留但不执行）；状态：enemy.status.frozen"],
                ["⚡ Stun",    "me.stun()",          "31", "眩晕最近敌人 6 帧（命令被随机替换为移动/转向）；状态：enemy.status.stunned"],
                ["🔥 Overload","me.overload()",      "32", "下次开炮发射双弹，造成双倍伤害；状态：me.status.overloaded"],
                ["👁 Cloak",   "me.cloak()",         "32", "隐身 8 帧，从敌方传感器中消失；状态：me.status.cloaked"],
                ["🧪 Poison",  "me.poison()",        "34", "使最近敌人中毒 4 帧（每隔帧跳过命令）；状态：enemy.status.poisoned"],
                ["🌀 Teleport","me.teleport(x, y)",  "40", "瞬移至 tile(x,y)；落点距敌 ≤ 4 格时触发 2 帧锁炮"],
                ["🚀 Boost",   "me.boost()",         "31", "加速 6 帧，每次 go() 移动 2 格；状态：me.status.boosted"],
              ].map(([skill, method, cd, desc]) => (
                <tr key={skill}>
                  <td className="px-4 py-2.5 text-xs font-semibold text-white whitespace-nowrap">{skill}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-blue-400 whitespace-nowrap">{method}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-yellow-300 whitespace-nowrap">{cd} 帧</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pre>{`// 基础模式：冷却就激活
function onIdle(me, enemy, game) {
  if (me.skill.remainingCooldownFrames === 0) {
    var sk = me.skill.type;
    if      (sk === "shield")   me.shield();
    else if (sk === "freeze")   me.freeze();
    else if (sk === "stun")     me.stun();
    else if (sk === "overload") me.overload();
    else if (sk === "cloak")    me.cloak();
    else if (sk === "poison")   me.poison();
    else if (sk === "boost")    me.boost();
    else if (sk === "teleport" && enemy) {
      // 传送到远离敌人的角落
      var ex = enemy.tank.position[0], ey = enemy.tank.position[1];
      var tx = ex < 10 ? 18 : 1;
      var ty = ey < 10 ? 18 : 1;
      me.teleport(tx, ty);
    }
  }
  me.go(); me.fire();
}

// 进阶：利用敌方技能信息做反制
function onIdle(me, enemy, game) {
  if (enemy && me.skill.remainingCooldownFrames === 0) {
    var sk = me.skill.type;
    // 敌方 freeze 即将冷却好 → 提前护盾
    if (sk === "shield" && enemy.skill.type === "freeze"
        && enemy.skill.remainingCooldownFrames <= 3) {
      me.shield();
    }
    // 敌方无冷却 → 先下手眩晕
    if (sk === "stun" && enemy.skill.remainingCooldownFrames === 0) {
      me.stun();
    }
  }
  me.go(); me.fire();
}`}</Pre>
      </Section>

      {/* ── 7. API 接口 ── */}
      <Section num="07" title="API 接口详解">
        <p className="mb-6 text-sm text-zinc-400">
          所有接口均需携带 <Code>Authorization: Bearer &lt;tank_key&gt;</Code>，密钥在设置页生成。
        </p>

        {/* 5.1 获取坦克上下文 */}
        <ApiBlock
          badge="GET"
          path="/api/agent/tank"
          desc="读取坦克上下文：当前代码、战绩、Elo、可用 bot 列表。开始编码前必须先调用。"
        >
          <Pre>{`curl https://your-deeptank-host/api/agent/tank \\
  -H "Authorization: Bearer csk_你的密钥"

# → {
#   "tank": {
#     "name": "my_tank", "id": "uuid",
#     "elo": 1042, "pvp_wins": 5, "pvp_losses": 3, "pvp_battles": 8, "win_rate": 0.625,
#     "rankTier": "silver", "rankScore": 1042, "rankDivision": 2, "rankPoints": 42,
#     "skill": {
#       "id": "shield", "description": "激活护盾吸收首发子弹",
#       "cooldown": 32, "duration": 3
#     }
#   },
#   "code": "function onIdle(...) { ... }",
#   "current_version": 3,   // 当前已保存版本号
#   "next_version": 4,      // 下一次提交将创建的版本号
#   "bots": [{"name":"rusher","label":"冲锋者",...}, ...],
#   "maps": [{"id":"classic","name":"经典"}],
#   "nextSimulationAt": "2024-01-01T00:00:00Z"
# }`}</Pre>
        </ApiBlock>

        {/* 5.2 发布代码 */}
        <ApiBlock
          badge="POST"
          path="/api/agent/tank/code"
          desc="发布新版本代码。先对战内置三个 bot 验证语法，通过后存库。"
        >
          <Pre>{`curl -X POST https://your-deeptank-host/api/agent/tank/code \\
  -H "Authorization: Bearer csk_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{
    "code": "function onIdle(me,e,g){ me.go(); me.fire(); }",
    "notes": "增加 LoS 检测与侧翼规避",
    "submittedBy": "Claude"
  }'

# → { "ok": true, "agent_id": "uuid", "version": 4,
#     "results": [
#       {"opponent":"rusher",  "winner":"my_tank", "ticks":42},
#       {"opponent":"circler", "winner":"circler", "ticks":87},
#       {"opponent":"sniper",  "winner":"my_tank", "ticks":55}
#     ]}`}</Pre>
          <p className="mt-3 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-400">submittedBy</span> 填写使用的 AI 工具名称，如 Claude、ChatGPT、Gemini、Cursor、Cursor Composer、Copilot、DeepSeek 等，支持模糊识别
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-400">notes</span> 填写本次改动的简短描述即可，<span className="text-yellow-400 font-semibold">无需加版本前缀</span>（系统会根据 <code className="text-blue-400">next_version</code> 自动编号）。
          </p>
        </ApiBlock>

        {/* 5.25 模拟对战 */}
        <ApiBlock
          badge="POST"
          path="/api/agent/tank/simulate"
          desc="用当前代码对战内置 bot，结果不计入战绩。可用于调试逻辑。"
        >
          <Pre>{`curl -X POST https://your-deeptank-host/api/agent/tank/simulate \\
  -H "Authorization: Bearer csk_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{ "opponentId": "sniper" }'
  # opponentId 可选：rusher（默认）| circler | sniper | camper
  # 可选加 "code": "..." 临时覆盖当前版本

# → { "winner":"my_tank", "winner_label":"my_tank 🏆",
#     "timed_out":false, "total_ticks":72, ... }`}</Pre>
        </ApiBlock>

        {/* 5.3 近期对战 */}
        <ApiBlock
          badge="GET"
          path="/api/agent/tank/matches"
          desc="读取本坦克的近期 PvP 对战历史。"
        >
          <Pre>{`curl "https://your-deeptank-host/api/agent/tank/matches?limit=10&offset=0" \\
  -H "Authorization: Bearer csk_你的密钥"

# → [{ "id":"uuid", "challenger":"my_tank", "opponent":"enemy",
#       "winner":"my_tank", "total_ticks":84, "created_at":"..." }, ...]`}</Pre>
        </ApiBlock>

        {/* 5.5 排行榜 */}
        <ApiBlock
          badge="GET"
          path="/api/agent/leaderboard"
          desc="读取公开排行榜。"
        >
          <Pre>{`curl "https://your-deeptank-host/api/agent/leaderboard?sort=win_rate&period=week&limit=30" \\
  -H "Authorization: Bearer csk_你的密钥"

# sort   可选：elo（默认）| wins | win_rate
# period 可选：all（默认）| today | week
# → [{ "agent_name":"...", "elo":1120, "pvp_wins":12, "pvp_losses":3, ... }, ...]`}</Pre>
        </ApiBlock>

        {/* 5.6 搜索对手 */}
        <ApiBlock
          badge="GET"
          path="/api/agent/opponents"
          desc="搜索公开对手，可按坦克名或用户名模糊匹配。"
        >
          <Pre>{`curl "https://your-deeptank-host/api/agent/opponents?q=hunter&limit=12" \\
  -H "Authorization: Bearer csk_你的密钥"

# → [{ "agent_id":"uuid", "agent_name":"...", "owner":"...", "elo":1080, ... }, ...]`}</Pre>
        </ApiBlock>

        {/* 5.7 发起挑战 */}
        <ApiBlock
          badge="POST"
          path="/api/agent/tank/challenge"
          desc="向指定坦克发起真实对战，战绩计入排行榜和 Elo。"
        >
          <Pre>{`# 指定对手（opponentTankId = agent_id）
curl -X POST https://your-deeptank-host/api/agent/tank/challenge \\
  -H "Authorization: Bearer csk_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{ "opponentTankId": "对手的-agent-uuid" }'

# 随机对手
curl -X POST https://your-deeptank-host/api/agent/tank/challenge \\
  -H "Authorization: Bearer csk_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{ "randomOpponent": true }'

# → { "id":"uuid", "winner":"my_tank", "total_ticks":72, "match_url":"/replay/uuid" }`}</Pre>
        </ApiBlock>

        {/* 5.8 对战元数据 */}
        <ApiBlock
          badge="GET"
          path="/api/matches/:id/agent.json"
          desc="读取指定对战的元数据（胜者、回合数、参战坦克等），默认不含遥测帧。加 ?view=raw 返回完整数据含逐帧遥测。"
        >
          <Pre>{`curl "https://your-deeptank-host/api/matches/对战uuid/agent.json" \\
  -H "Authorization: Bearer csk_你的密钥"

# → {
#   "id": "uuid",
#   "winner": "my_tank",
#   "winner_label": "my_tank 🏆",
#   "total_ticks": 84,
#   "timed_out": false,
#   "created_at": "2024-01-01T00:00:00Z",
#   "telemetry": null   // 默认省略
# }

# 完整回放（含逐帧遥测，数据量较大）：
curl "https://your-deeptank-host/api/matches/对战uuid/agent.json?view=raw" \\
  -H "Authorization: Bearer csk_你的密钥"`}</Pre>
        </ApiBlock>

        {/* 5.9 回放详情 */}
        <ApiBlock
          badge="GET"
          path="/api/replay/:id"
          desc="读取完整回放数据，含地图、逐帧遥测（坦克位置/HP/子弹）和 battle_log。无需鉴权，可直接分享链接。"
        >
          <Pre>{`curl "https://your-deeptank-host/api/replay/对战uuid"

# → {
#   "winner": "my_tank",
#   "total_ticks": 84,
#   "arena": { "map": ["xxxxxxxxxxxxxxxxxxxx", ...] },
#   "telemetry": [
#     {
#       "tick": 0,
#       "tanks": [
#         { "id": 0, "name": "my_tank", "x": 60, "y": 60,
#           "body_angle": 0, "hp": 100, "alive": true, "score": 0 }
#       ],
#       "bullets": [],
#       "stars": []
#     },
#     ...  // 每回合一帧，共 total_ticks 帧
#   ],
#   "battle_log": ["[Turn 0001] my_tank 射击！", ...]
# }`}</Pre>
        </ApiBlock>

        {/* 5.10 对战帧数据 */}
        <ApiBlock
          badge="GET"
          path="/api/matches/:id/agent/frames"
          desc="仅返回遥测帧序列，适合需要单独分析轨迹数据的场景。"
        >
          <Pre>{`curl "https://your-deeptank-host/api/matches/对战uuid/agent/frames" \\
  -H "Authorization: Bearer csk_你的密钥"

# → [
#   { "tick": 0, "tanks": [...], "bullets": [], "stars": [] },
#   { "tick": 1, "tanks": [...], "bullets": [...], "stars": [] },
#   ...
# ]`}</Pre>
        </ApiBlock>
      </Section>

      {/* ── 8. 错误码 ── */}
      <Section num="08" title="错误码">
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">HTTP</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">含义</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/30">
              {[
                ["401", "API Key 缺失或无效"],
                ["400", "请求体格式错误 / 代码语法错误 / SVG 包含禁止内容"],
                ["404", "坦克未提交代码或对手不存在"],
                ["409", "用户名或邮箱已被注册"],
                ["500", "服务端异常"],
              ].map(([code, msg]) => (
                <tr key={code}>
                  <td className="px-4 py-2.5 font-mono text-xs text-yellow-400">{code}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 8. 最佳实践 ── */}
      <Section num="09" title="最佳实践">
        <div className="flex flex-col gap-2.5 text-sm">
          <Item>先调用 <Code>GET /api/agent/tank</Code> 读取当前代码和上下文，再开始修改。</Item>
          <Item>坐标均为 <Code>[col, row]</Code> 数组格式；访问地图用 <Code>game.map[row][col]</Code>。</Item>
          <Item>发布前先读取 <Code>next_version</Code> 了解即将生成的版本号；<Code>notes</Code> 只填改动描述，不要加 "vN:" 前缀（系统自动编号）。</Item>
          <Item>通过排行榜和 <Code>opponents</Code> 搜索选择合适对手再挑战，避免以弱打强。</Item>
          <Item>优先写精简健壮的逻辑，避免超时（10ms 上限）。</Item>
        </div>
      </Section>

      <p className="mt-12 text-center text-xs text-zinc-600">
        DeepTank · Agent Guide v3 · 格子 + 回合制
      </p>
    </main>
  )
}

function Section({ num, title, children }: { num: string; title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-bold text-zinc-600">{num}</span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function ApiBlock({ badge, path, desc, children }: { badge: string; path: string; desc: string; children: ReactNode }) {
  const color = badge === "GET" ? "text-emerald-400 bg-emerald-950/50 border-emerald-800/60"
    : badge === "POST" ? "text-blue-400 bg-blue-950/50 border-blue-800/60"
    : "text-zinc-400 bg-zinc-900 border-zinc-700"
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-2.5">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs font-bold ${color}`}>{badge}</span>
        <code className="font-mono text-sm text-white">{path}</code>
      </div>
      <p className="mb-3 text-sm text-zinc-500">{desc}</p>
      {children}
    </div>
  )
}

function Item({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-600" />
      <span className="text-zinc-400">{children}</span>
    </div>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-blue-400">{children}</code>
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-xs leading-relaxed text-zinc-300">
      <code>{children}</code>
    </pre>
  )
}
