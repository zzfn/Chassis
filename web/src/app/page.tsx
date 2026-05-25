"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Cpu, Crosshair, PlayCircle, Code2, Swords, Trophy, Rocket, ChevronRight, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

const features = [
  { icon: Cpu,        title: "沙箱隔离执行", desc: "QuickJS 沙箱严格限制内存 2MB / 单帧 10ms，崩溃或死循环都不影响主服务。" },
  { icon: Crosshair,  title: "战场感知系统", desc: "每回合注入位置、HP、敌人方位、地图字符与冷却状态，自由设计战术。" },
  { icon: PlayCircle, title: "完整回放遥测", desc: "每场战斗逐帧录制为遥测 JSON，回放、暂停、拖动进度条，逐帧复盘 AI 决策。" },
]

const flow = [
  { icon: Code2,  step: "01", title: "编写策略", desc: "在浏览器内编辑器写 onIdle 函数，控制移动、转向、射击。" },
  { icon: Rocket, step: "02", title: "提交上链", desc: "API 提交代码，沙箱先跑三场 Bot 测试验证语法。" },
  { icon: Swords, step: "03", title: "天梯对战", desc: "向真实玩家发起挑战，每场胜负计入排行榜与 Elo。" },
  { icon: Trophy, step: "04", title: "迭代上分", desc: "通过对战回放定位决策漏洞，迭代代码冲击铂金。" },
]

const aiTags = ["Claude", "ChatGPT", "Gemini", "DeepSeek", "Qwen", "Grok", "Copilot", "Cursor"]

const SAMPLE_CODE = `function onIdle(me, enemy, game) {
  if (!enemy) { me.turn("right"); return; }

  var dx = enemy.tank.position[0] - me.tank.position[0];
  var dy = enemy.tank.position[1] - me.tank.position[1];

  // 朝向敌人，能开火就开火
  if (Math.abs(dx) >= Math.abs(dy)) {
    me.turn(dx > 0 ? "right" : "left");
  }
  if (me.tank.shootCooldown === 0) me.fire();
  me.go();
}`

// 极简 JS tokenizer + VS Code Dark+ 配色 —— 用于落地页代码片段高亮
type TokenType = "kw" | "fn" | "var" | "str" | "num" | "cmt" | "punc"
const KEYWORDS = new Set([
  "function", "if", "else", "var", "let", "const", "return", "for", "while",
  "true", "false", "null", "undefined", "new", "this", "typeof",
])
const COLOR: Record<TokenType, string> = {
  kw:   "text-[#C586C0]",
  fn:   "text-[#DCDCAA]",
  var:  "text-[#9CDCFE]",
  str:  "text-[#CE9178]",
  num:  "text-[#B5CEA8]",
  cmt:  "text-[#6A9955] italic",
  punc: "text-zinc-400",
}

function tokenize(code: string): Array<{ t: TokenType; v: string }> {
  const out: Array<{ t: TokenType; v: string }> = []
  let i = 0
  while (i < code.length) {
    const c = code[i]
    // 行注释
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i)
      const stop = end < 0 ? code.length : end
      out.push({ t: "cmt", v: code.slice(i, stop) })
      i = stop
      continue
    }
    // 字符串
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== c) j++
      out.push({ t: "str", v: code.slice(i, j + 1) })
      i = j + 1
      continue
    }
    // 标识符 / 关键字 / 函数
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < code.length && /[A-Za-z0-9_$]/.test(code[j])) j++
      const word = code.slice(i, j)
      if (KEYWORDS.has(word)) {
        out.push({ t: "kw", v: word })
      } else {
        let k = j
        while (k < code.length && /\s/.test(code[k])) k++
        out.push({ t: code[k] === "(" ? "fn" : "var", v: word })
      }
      i = j
      continue
    }
    // 数字
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < code.length && /[0-9.]/.test(code[j])) j++
      out.push({ t: "num", v: code.slice(i, j) })
      i = j
      continue
    }
    // 标点 / 空白 / 操作符 —— 合并连续 punc 字符以减少 span 数量
    let j = i
    while (
      j < code.length &&
      !/[A-Za-z0-9_$"']/.test(code[j]) &&
      !(code[j] === "/" && code[j + 1] === "/")
    ) j++
    out.push({ t: "punc", v: code.slice(i, j) })
    i = j
  }
  return out
}

function HighlightedCode({ code }: { code: string }) {
  const tokens = tokenize(code)
  return (
    <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
      <code>
        {tokens.map((tk, i) => (
          <span key={i} className={COLOR[tk.t]}>{tk.v}</span>
        ))}
      </code>
    </pre>
  )
}

export default function HomePage() {
  const reduce = useReducedMotion()
  const fadeUp = {
    hidden: { opacity: 0, y: reduce ? 0 : 24 },
    show:   { opacity: 1, y: 0 },
  }

  return (
    <main className="flex flex-1 flex-col bg-zinc-950 overflow-hidden">

      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 py-32 text-center">
        {/* 网格背景 */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 60% 50% at 50% 30%, black 40%, transparent 80%)",
          }}
        />
        {/* 光晕呼吸 */}
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.18),transparent)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: reduce ? 1 : [0.6, 1, 0.6] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* 扫描线 */}
        {!reduce && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-32 bg-gradient-to-b from-transparent via-blue-500/10 to-transparent"
            initial={{ top: "-10%" }}
            animate={{ top: "110%" }}
            transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
          />
        )}

        <motion.div
          className="relative z-10 flex flex-col items-center gap-6"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } } }}
        >
          {/* 状态徽章 */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-xs font-medium text-emerald-400"
          >
            <motion.span
              aria-hidden
              className="mr-2 size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
              animate={{ opacity: reduce ? 1 : [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            第一赛季 · 正式开赛 · 实时天梯
          </motion.div>

          {/* 主标题 */}
          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="max-w-4xl text-6xl font-extrabold tracking-tight text-white md:text-7xl lg:text-8xl"
          >
            Deep
            <motion.span
              className="text-blue-500 inline-block"
              animate={
                reduce
                  ? undefined
                  : {
                      textShadow: [
                        "0 0 0px rgba(59,130,246,0)",
                        "0 0 28px rgba(59,130,246,0.8)",
                        "0 0 0px rgba(59,130,246,0)",
                      ],
                    }
              }
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              Tank
            </motion.span>
          </motion.h1>

          {/* 副标题 */}
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="max-w-xl text-lg text-zinc-400 md:text-xl"
          >
            AI 编写策略 · 代码决定输赢
          </motion.p>

          {/* 标语 */}
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="font-mono text-xs uppercase tracking-[0.4em] text-zinc-600"
          >
            &gt; Code · Compile · Combat
          </motion.p>

          {/* CTA */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mt-2 flex flex-wrap items-center justify-center gap-3"
          >
            <motion.div whileHover={reduce ? undefined : { scale: 1.05 }} whileTap={{ scale: 0.97 }}>
              <Link
                href="/tanks"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "group bg-blue-600 px-8 text-white hover:bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.35)]"
                )}
              >
                我的坦克
                <ChevronRight className="ml-1 size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
            <motion.div whileHover={reduce ? undefined : { scale: 1.05 }} whileTap={{ scale: 0.97 }}>
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "border-zinc-700 bg-transparent px-8 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                )}
              >
                查看排行榜
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ───────────────────────── AI 标签 marquee ───────────────────────── */}
      <section className="relative border-y border-zinc-900 bg-zinc-950/60 py-5">
        <div className="absolute left-0 top-0 z-10 h-full w-24 bg-gradient-to-r from-zinc-950 to-transparent" />
        <div className="absolute right-0 top-0 z-10 h-full w-24 bg-gradient-to-l from-zinc-950 to-transparent" />
        <motion.div
          className="flex gap-12 whitespace-nowrap"
          animate={reduce ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
        >
          {[...aiTags, ...aiTags, ...aiTags].map((tag, i) => (
            <div key={`${tag}-${i}`} className="flex shrink-0 items-center gap-2 text-sm font-mono uppercase tracking-widest text-zinc-600">
              <Zap className="size-3.5 text-blue-500/60" />
              {tag}
              <span className="text-zinc-800">·</span>
            </div>
          ))}
        </motion.div>
        <p className="mt-4 text-center text-[11px] uppercase tracking-[0.3em] text-zinc-700">
          支持任意 AI 编写策略 — 你只负责提交代码
        </p>
      </section>

      {/* ───────────────────────── 游戏循环 4 步 ───────────────────────── */}
      <section className="relative mx-auto w-full max-w-6xl px-4 py-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.4em] text-blue-500">// game loop</p>
          <h2 className="text-3xl font-extrabold text-white md:text-4xl">从一行代码到登顶天梯</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">四步循环、毫秒级反馈，越战越强。</p>
        </motion.div>

        <motion.div
          className="grid gap-4 md:grid-cols-4"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ show: { transition: { staggerChildren: 0.12 } } }}
        >
          {flow.map(f => (
            <motion.div
              key={f.step}
              variants={fadeUp}
              transition={{ duration: 0.5, ease: "easeOut" }}
              whileHover={reduce ? undefined : { y: -4 }}
              className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
            >
              <div className="absolute -right-2 -top-2 font-mono text-5xl font-black text-zinc-800/50 select-none">{f.step}</div>
              <div className="relative">
                <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20">
                  <f.icon className="size-5 text-blue-400" />
                </div>
                <h3 className="text-base font-bold text-white">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ───────────────────────── 代码示例 + 特性 ───────────────────────── */}
      <section className="relative mx-auto w-full max-w-6xl px-4 pb-24">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* 左：代码片段 */}
          <motion.div
            initial={{ opacity: 0, x: reduce ? 0 : -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-red-500/70" />
                <span className="size-2.5 rounded-full bg-yellow-500/70" />
                <span className="size-2.5 rounded-full bg-emerald-500/70" />
              </div>
              <span className="font-mono text-xs text-zinc-500">agent.js · onIdle</span>
              <motion.span
                className="font-mono text-[10px] uppercase tracking-widest text-emerald-500"
                animate={reduce ? undefined : { opacity: [1, 0.4, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >● LIVE</motion.span>
            </div>
            <HighlightedCode code={SAMPLE_CODE} />
            <div className="border-t border-zinc-800 bg-zinc-900/40 px-5 py-2.5 font-mono text-[11px] text-zinc-500">
              <span className="text-emerald-400">$</span> deeptank run agent.js{" "}
              <motion.span
                className="text-blue-400"
                animate={reduce ? undefined : { opacity: [1, 0, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >_</motion.span>
            </div>
          </motion.div>

          {/* 右：特性 */}
          <motion.div
            className="flex flex-col gap-4"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            <motion.div variants={fadeUp} transition={{ duration: 0.5 }} className="mb-1">
              <p className="font-mono text-xs uppercase tracking-[0.4em] text-blue-500">// engine</p>
              <h2 className="mt-2 text-3xl font-extrabold text-white md:text-4xl">为竞技而生</h2>
            </motion.div>
            {features.map(f => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                transition={{ duration: 0.5, ease: "easeOut" }}
                whileHover={reduce ? undefined : { x: 4 }}
              >
                <Card className="border-zinc-800 bg-zinc-900/60 text-zinc-100 ring-0">
                  <CardHeader className="flex-row items-start gap-4 space-y-0">
                    <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 ring-1 ring-blue-500/20">
                      <f.icon className="size-5 text-blue-400" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <CardTitle className="text-base font-semibold text-white">{f.title}</CardTitle>
                      <CardDescription className="text-zinc-400">{f.desc}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent />
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ───────────────────────── 底部 CTA ───────────────────────── */}
      <section className="relative overflow-hidden border-t border-zinc-900 px-4 py-24">
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(59,130,246,0.18),transparent)]"
          animate={reduce ? undefined : { opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
          className="relative mx-auto flex max-w-3xl flex-col items-center gap-5 text-center"
        >
          <p className="font-mono text-xs uppercase tracking-[0.5em] text-blue-500">// ready ?</p>
          <h2 className="text-4xl font-extrabold tracking-tight text-white md:text-5xl">
            进入战场，<br className="md:hidden" />
            让你的代码替你战斗
          </h2>
          <p className="max-w-xl text-base text-zinc-400">
            注册账号，5 分钟写出第一辆坦克，立刻挑战全球玩家。
          </p>
          <motion.div whileHover={reduce ? undefined : { scale: 1.05 }} whileTap={{ scale: 0.97 }}>
            <Link
              href="/tanks"
              className={cn(
                buttonVariants({ size: "lg" }),
                "group bg-blue-600 px-10 text-base font-bold text-white hover:bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.45)]"
              )}
            >
              立即创建坦克
              <ChevronRight className="ml-1 size-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </motion.div>
      </section>
    </main>
  )
}
