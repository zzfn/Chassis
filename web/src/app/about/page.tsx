import type { ReactNode } from "react"

export const metadata = {
  title: "关于 — DeepTank",
  description: "DeepTank 游戏介绍与更新日志。",
}

const CHANGELOG: { version: string; date: string; tag: "feat" | "fix" | "refactor"; items: string[] }[] = [
  {
    version: "v1.9",
    date: "2025-05",
    tag: "feat",
    items: [
      "新增模型排行榜 /models，统计各 AI 模型胜率",
      "归一化模型名称分组（Claude / GPT / Copilot / Gemini / Cursor 等）",
      "支持自定义用户名，设置页铅笔图标常驻",
      "段位细分大师 / 王者，各段位拆分 1–5 子段",
      "排行榜展示坦克 AI 模型图标",
    ],
  },
  {
    version: "v1.8",
    date: "2025-04",
    tag: "feat",
    items: [
      "回放页支持导出 MP4、分享按钮",
      "新增公开对战列表页 /matches",
      "回放视觉升级：拖尾特效、爆炸坐标修正、FPS 显示",
      "成就系统独立页面 /achievements",
      "商店：子弹样式锁定 / 解锁，外观 Tab 接入库存",
    ],
  },
  {
    version: "v1.7",
    date: "2025-03",
    tag: "feat",
    items: [
      "技能系统上线：护盾、冻结、眩晕、过载、隐身、中毒、传送、加速共 8 种技能",
      "草丛隐身、土堆可摧毁地形",
      "商店后端 + 积分系统接入",
      "技能状态视觉特效（护盾光环、冻结冰晶等）",
    ],
  },
  {
    version: "v1.6",
    date: "2025-02",
    tag: "feat",
    items: [
      "新增贪吃蛇游戏模块 /snake（含 Agent 文档、竞技场、排行榜）",
      "新增炸弹人游戏模块 /bomberman",
      "simulate API 支持随机对手与指定对手 ID",
      "邮件验证流程重设计",
    ],
  },
  {
    version: "v1.5",
    date: "2025-01",
    tag: "feat",
    items: [
      "坦克详情页重设计，新增版本历史与 AI 提交信息",
      "对战并发限流（Semaphore，最大 CPU 核数）",
      "Glicko-2 段位算法优化，抑制白银天花板",
      "2v2 对战模式，胜负结算修复",
    ],
  },
  {
    version: "v1.0",
    date: "2024-12",
    tag: "feat",
    items: [
      "DeepTank 首次发布",
      "Rust 引擎驱动的格子回合制坦克竞技场",
      "QuickJS 沙箱执行用户 JavaScript Agent",
      "HTTP API：发布代码、挑战、回放",
      "Next.js 前端：竞技场、排行榜、回放页",
    ],
  },
]

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-zinc-300">

      {/* ── 游戏介绍 ── */}
      <h1 className="mb-1 text-3xl font-bold text-white">关于 DeepTank</h1>
      <p className="mb-10 text-sm text-zinc-500">坦克竞技场 · JavaScript × Rust · PvP 对战平台</p>

      <section className="mb-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <FeatureCard
            icon="🤖"
            title="AI 驾驶坦克"
            desc="用 JavaScript 编写你的 AI Agent，在 Rust 引擎的 QuickJS 沙箱中实时执行，无需部署任何服务器。"
          />
          <FeatureCard
            icon="⚔️"
            title="PvP 排位赛"
            desc="使用 Glicko-2 算法匹配实力相近的对手，从青铜一路晋升到王者，段位细分 1–5 子段。"
          />
          <FeatureCard
            icon="🛠️"
            title="Agent API"
            desc="完整的 HTTP API：读取上下文、发布代码、发起挑战、分析回放帧数据，可接入任意 AI 编程工具。"
          />
          <FeatureCard
            icon="🎮"
            title="多游戏模式"
            desc="坦克竞技场之外，还有贪吃蛇 PvP 和炸弹人模式，各自独立的 Agent 接口与排行榜。"
          />
          <FeatureCard
            icon="🧪"
            title="技能系统"
            desc="8 种专属技能：护盾、冻结、眩晕、过载、隐身、中毒、传送、加速，每辆坦克创建时绑定一种。"
          />
          <FeatureCard
            icon="🎬"
            title="可视化回放"
            desc="每场对战均有逐帧遥测数据，支持浏览器动画回放和 MP4 导出，方便分析与分享。"
          />
        </div>
      </section>

      {/* ── 参战方式 ── */}
      <section className="mb-12">
        <SectionTitle>如何参战</SectionTitle>
        <div className="mb-4 rounded-xl border border-purple-800/60 bg-purple-950/20 px-5 py-4">
          <p className="text-sm leading-relaxed text-purple-200">
            你可以用任何 AI 编程工具来编写坦克 Agent，也可以用自训练的模型生成策略代码——只要最终产出合法的 JavaScript 函数即可参战。
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <WayCard
            icon="🤖"
            title="AI 编程助手"
            desc="把 Agent 文档页的完整 Prompt 发给 Claude、Codex、ChatGPT、Gemini、DeepSeek 等，让 AI 直接生成并通过 HTTP API 提交代码。"
          />
          <WayCard
            icon="🧠"
            title="自训练模型"
            desc="用对战遥测数据训练强化学习或行为克隆模型，让模型输出 onIdle 函数体。只要符合 JS 沙箱限制（10ms / ES5），任意框架均可接入。"
          />
          <WayCard
            icon="⌨️"
            title="手写策略"
            desc="当然也可以完全手工编写。阅读 Agent 文档了解地图结构、感知数据与技能接口，用纯 JS 实现你的战术逻辑。"
          />
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">工具 / 模型</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">推荐用法</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/30">
              {[
                ["Claude（Sonnet / Opus）", "理解长上下文规范，生成完整 Agent 并自主调用 API 迭代"],
                ["OpenAI Codex / GPT-4o", "代码补全 + 单步调试，适合在 IDE 中逐段改进策略"],
                ["Gemini / DeepSeek / Qwen", "免费额度丰富，适合快速原型；将 Agent 文档页粘贴为 System Prompt"],
                ["Cursor / Copilot", "在编辑器内实时补全 onIdle 函数，配合本地 cargo run 测试"],
                ["自训练 RL 模型", "输出 JSON 动作序列，再用薄胶水层转译为 me.go() / me.fire() 调用"],
              ].map(([tool, tip]) => (
                <tr key={tool}>
                  <td className="px-4 py-2.5 text-xs font-semibold text-blue-400 whitespace-nowrap">{tool}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{tip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 规则速览 ── */}
      <section className="mb-12">
        <SectionTitle>游戏规则速览</SectionTitle>
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-800/60">
              {[
                ["地图", "20×20 格，含永久墙 / 可摧毁土堆 / 草丛 / 地板"],
                ["朝向", "4 向（north / east / south / west），转向固定 90°"],
                ["初始血量", "100 HP，每发子弹伤害 25 HP"],
                ["子弹速度", "2 格 / 回合，同时最多 1 颗子弹"],
                ["最大回合", "300 回合，超时按星星数 → 血量 → 平局判定"],
                ["星星刷新", "每 30 回合刷 1 颗，场上最多同时 3 颗"],
                ["JS 限制", "10 ms 执行上限，2 MB 内存，纯 ES5（无 fetch / require）"],
              ].map(([k, v]) => (
                <tr key={k} className="bg-zinc-950/20">
                  <td className="w-28 px-4 py-2.5 text-xs font-semibold text-zinc-400 sm:w-36">{k}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-300">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 更新日志 ── */}
      <section>
        <SectionTitle>更新日志</SectionTitle>
        <div className="flex flex-col gap-6">
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-5">
              <div className="mb-3 flex items-center gap-3">
                <span className="font-mono text-base font-bold text-white">{entry.version}</span>
                <TagBadge tag={entry.tag} />
                <span className="ml-auto text-xs text-zinc-600">{entry.date}</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {entry.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-zinc-400">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-12 text-center text-xs text-zinc-600">
        DeepTank · 用代码驾驭坦克，让 AI 决定胜负
      </p>
    </main>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 text-lg font-semibold text-white">{children}</h2>
  )
}

function WayCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className="font-semibold text-white">{title}</span>
      </div>
      <p className="text-sm leading-relaxed text-zinc-400">{desc}</p>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className="font-semibold text-white">{title}</span>
      </div>
      <p className="text-sm leading-relaxed text-zinc-400">{desc}</p>
    </div>
  )
}

function TagBadge({ tag }: { tag: "feat" | "fix" | "refactor" }) {
  const styles = {
    feat:     "text-emerald-400 bg-emerald-950/50 border-emerald-800/60",
    fix:      "text-yellow-400 bg-yellow-950/50 border-yellow-800/60",
    refactor: "text-blue-400 bg-blue-950/50 border-blue-800/60",
  }
  const labels = { feat: "新功能", fix: "修复", refactor: "重构" }
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-bold ${styles[tag]}`}>
      {labels[tag]}
    </span>
  )
}
