"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { Cpu, Crosshair, PlayCircle, Code2, Swords, Trophy, Rocket, ChevronRight, Zap } from "lucide-react"

/* ── Data ── */

const features = [
  {
    icon: Cpu,
    title: "沙箱隔离执行",
    desc: "QuickJS 沙箱严格限制内存 2MB / 单帧 10ms，崩溃或死循环都不影响主服务。",
    accent: "#00F5D4",
    borderStyle: "solid" as const,
  },
  {
    icon: Crosshair,
    title: "战场感知系统",
    desc: "每回合注入位置、HP、敌人方位、地图字符与冷却状态，自由设计战术。",
    accent: "#FFE600",
    borderStyle: "dashed" as const,
  },
  {
    icon: PlayCircle,
    title: "完整回放遥测",
    desc: "每场战斗逐帧录制为遥测 JSON，回放、暂停、拖动进度条，逐帧复盘 AI 决策。",
    accent: "#FF6B35",
    borderStyle: "solid" as const,
  },
]

const flow = [
  {
    icon: Code2,
    step: "01",
    title: "编写策略",
    desc: "在浏览器内编辑器写 onIdle 函数，控制移动、转向、射击。",
    accent: "#FF3AF2",
    shadow1: "#FFE600",
    shadow2: "#7B2FFF",
  },
  {
    icon: Rocket,
    step: "02",
    title: "提交上链",
    desc: "API 提交代码，沙箱先跑三场 Bot 测试验证语法。",
    accent: "#00F5D4",
    shadow1: "#FF3AF2",
    shadow2: "#FFE600",
  },
  {
    icon: Swords,
    step: "03",
    title: "天梯对战",
    desc: "向真实玩家发起挑战，每场胜负计入排行榜与 Elo。",
    accent: "#FFE600",
    shadow1: "#00F5D4",
    shadow2: "#FF3AF2",
  },
  {
    icon: Trophy,
    step: "04",
    title: "迭代上分",
    desc: "通过对战回放定位决策漏洞，迭代代码冲击铂金。",
    accent: "#FF6B35",
    shadow1: "#7B2FFF",
    shadow2: "#00F5D4",
  },
]

const aiTags = ["Claude", "ChatGPT", "Gemini", "DeepSeek", "Qwen", "Grok", "Copilot", "Cursor"]
const TAG_COLORS = ["#FF3AF2", "#00F5D4", "#FFE600", "#FF6B35", "#7B2FFF"]

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

/* ── Tokenizer (VS Code Dark+ palette) ── */
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
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i)
      const stop = end < 0 ? code.length : end
      out.push({ t: "cmt", v: code.slice(i, stop) })
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== c) j++
      out.push({ t: "str", v: code.slice(i, j + 1) })
      i = j + 1
      continue
    }
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
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < code.length && /[0-9.]/.test(code[j])) j++
      out.push({ t: "num", v: code.slice(i, j) })
      i = j
      continue
    }
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

/* ── Page ── */

export default function HomePage() {
  const reduce = useReducedMotion()
  const fadeUp = {
    hidden: { opacity: 0, y: reduce ? 0 : 24 },
    show:   { opacity: 1, y: 0 },
  }

  return (
    <main className="flex flex-1 flex-col bg-[#0D0D1A] overflow-hidden">

      {/* ══════════════════════════ HERO ══════════════════════════ */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-32 text-center">

        {/* Pattern layers */}
        <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.12]" />
        <div className="pointer-events-none absolute inset-0 pattern-stripes" />
        <div className="pointer-events-none absolute inset-0 pattern-mesh" />

        {/* Floating shapes */}
        <div className="animate-max-float pointer-events-none absolute top-[12%] left-[6%] select-none text-6xl" aria-hidden="true">⭐</div>
        <div className="animate-max-float-reverse pointer-events-none absolute top-[18%] right-[8%] select-none text-5xl" aria-hidden="true">💥</div>
        <div className="animate-max-wiggle pointer-events-none absolute top-[72%] left-[8%] select-none text-4xl" aria-hidden="true">⚡</div>
        <div className="animate-max-bounce pointer-events-none absolute top-[65%] right-[10%] select-none text-5xl" aria-hidden="true">🏆</div>
        <div
          className="animate-max-float pointer-events-none absolute top-[30%] left-[15%] size-8 rounded-full"
          style={{ background: "#FFE600", boxShadow: "0 0 15px rgba(255,230,0,0.6)", opacity: 0.6 }}
          aria-hidden="true"
        />
        <div
          className="animate-max-float-reverse pointer-events-none absolute top-[45%] right-[18%] size-12 rounded-full"
          style={{ border: "4px solid #00F5D4", boxShadow: "0 0 20px rgba(0,245,212,0.5)", opacity: 0.4 }}
          aria-hidden="true"
        />
        <div
          className="animate-max-spin-slow pointer-events-none absolute bottom-[25%] left-[20%] size-16 rounded-xl"
          style={{ border: "4px solid #7B2FFF", opacity: 0.25 }}
          aria-hidden="true"
        />
        <div
          className="animate-max-float-slow pointer-events-none absolute top-[8%] right-[28%] size-6"
          style={{ background: "#FF3AF2", borderRadius: "2px", transform: "rotate(45deg)", opacity: 0.5 }}
          aria-hidden="true"
        />

        {/* Content */}
        <motion.div
          className="relative z-10 flex flex-col items-center gap-6"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } } }}
        >
          {/* Status badge */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="inline-flex items-center rounded-full border-4 border-[#00F5D4] bg-[#2D1B4E]/80 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-[#00F5D4]"
            style={{ boxShadow: "0 0 15px rgba(0,245,212,0.3), 2px 2px 0 #7B2FFF" }}
          >
            <motion.span
              aria-hidden
              className="mr-2 size-2 rounded-full bg-[#00F5D4]"
              animate={{ opacity: reduce ? 1 : [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            第一赛季 · 正式开赛 · 实时天梯
          </motion.div>

          {/* H1 */}
          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="max-w-5xl text-7xl font-black uppercase tracking-tighter text-white md:text-8xl lg:text-9xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "4px 4px 0px #7B2FFF, 8px 8px 0px #FF3AF2, 12px 12px 0px #00F5D4",
            }}
          >
            Deep<span className="text-gradient-max">Tank</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="text-xl font-black uppercase tracking-[0.3em] text-[#00F5D4] md:text-2xl"
            style={{ textShadow: "0 0 20px rgba(0,245,212,0.6)" }}
          >
            AI 编写策略 · 代码决定输赢
          </motion.p>

          {/* Tagline */}
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="font-mono text-xs font-black uppercase tracking-[0.5em] text-[#FFE600]"
          >
            &gt; Code · Compile · Combat
          </motion.p>

          {/* CTAs */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mt-4 flex flex-wrap items-center justify-center gap-5"
          >
            <motion.div whileHover={reduce ? undefined : { scale: 1.08 }} whileTap={{ scale: 0.95 }}>
              <Link
                href="/tanks"
                className="inline-flex items-center gap-2 rounded-full border-4 border-[#FFE600] px-10 py-4 text-base font-black uppercase tracking-widest text-white transition-shadow duration-300"
                style={{
                  background: "linear-gradient(135deg, #FF3AF2, #7B2FFF, #00F5D4)",
                  boxShadow: "0 0 30px rgba(255,58,242,0.5), 8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF",
                }}
              >
                我的坦克
                <ChevronRight className="size-5" />
              </Link>
            </motion.div>
            <motion.div whileHover={reduce ? undefined : { scale: 1.05 }} whileTap={{ scale: 0.97 }}>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full border-4 border-dashed border-[#00F5D4] px-10 py-4 text-base font-black uppercase tracking-widest text-[#00F5D4] transition-all duration-300 hover:bg-[#00F5D4]/10"
              >
                查看排行榜
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ══════════════════════════ AI MARQUEE ══════════════════════════ */}
      <section
        className="relative py-5"
        style={{
          borderTop: "4px solid #FF3AF2",
          borderBottom: "4px solid #FF3AF2",
          background: "rgba(13,13,26,0.95)",
          boxShadow: "0 0 30px rgba(255,58,242,0.25)",
        }}
      >
        <div className="absolute left-0 top-0 z-10 h-full w-24 bg-gradient-to-r from-[#0D0D1A] to-transparent" />
        <div className="absolute right-0 top-0 z-10 h-full w-24 bg-gradient-to-l from-[#0D0D1A] to-transparent" />
        <motion.div
          className="flex gap-12 whitespace-nowrap"
          animate={reduce ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        >
          {[...aiTags, ...aiTags, ...aiTags].map((tag, i) => {
            const color = TAG_COLORS[i % TAG_COLORS.length]
            return (
              <div key={`${tag}-${i}`} className="flex shrink-0 items-center gap-2 text-sm font-black uppercase tracking-widest" style={{ color }}>
                <Zap className="size-3.5" style={{ color }} aria-hidden="true" />
                {tag}
                <span className="text-white/20">·</span>
              </div>
            )
          })}
        </motion.div>
        <p className="mt-4 text-center text-xs font-bold uppercase tracking-[0.4em] text-white/35">
          支持任意 AI 编写策略 — 你只负责提交代码
        </p>
      </section>

      {/* ══════════════════════════ GAME LOOP ══════════════════════════ */}
      <section className="relative mx-auto w-full max-w-6xl overflow-hidden px-4 py-28">
        <div className="pointer-events-none absolute inset-0 pattern-stripes opacity-[0.08]" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
          className="relative mb-16 text-center"
        >
          <p className="mb-3 font-mono text-sm font-black uppercase tracking-[0.4em] text-[#7B2FFF]">// game loop</p>
          <h2
            className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
            }}
          >
            从一行代码到登顶天梯
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-white/50">四步循环、毫秒级反馈，越战越强。</p>
        </motion.div>

        <motion.div
          className="grid gap-6 md:grid-cols-4"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ show: { transition: { staggerChildren: 0.12 } } }}
        >
          {flow.map((f, idx) => (
            /* outer div carries the static tilt + offset; motion.div inside handles entrance + hover */
            <div
              key={f.step}
              style={{
                transform: `rotate(${idx % 2 === 0 ? "1deg" : "-1deg"}) translateY(${idx % 2 === 1 ? "16px" : "0"})`,
              }}
            >
              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.5, ease: "easeOut" }}
                whileHover={reduce ? undefined : { y: -10, transition: { duration: 0.2 } }}
                className="relative cursor-pointer overflow-hidden rounded-3xl p-6 backdrop-blur-sm"
                style={{
                  background: "rgba(45,27,78,0.5)",
                  border: `4px solid ${f.accent}`,
                  boxShadow: `8px 8px 0 ${f.shadow1}, 16px 16px 0 ${f.shadow2}`,
                }}
              >
                {/* Ghost step number */}
                <div
                  className="pointer-events-none absolute -right-2 -top-2 select-none font-mono text-6xl font-black opacity-[0.18]"
                  style={{ color: f.accent, fontFamily: "var(--font-outfit)" }}
                  aria-hidden="true"
                >
                  {f.step}
                </div>

                {/* Icon */}
                <div
                  className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border-2"
                  style={{
                    borderColor: f.accent,
                    background: `${f.accent}20`,
                    boxShadow: `0 0 14px ${f.accent}40`,
                  }}
                >
                  <f.icon className="size-6" style={{ color: f.accent }} />
                </div>

                <h3
                  className="text-base font-black uppercase tracking-wide text-white"
                  style={{ textShadow: `1px 1px 0px ${f.accent}` }}
                >
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{f.desc}</p>
              </motion.div>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ══════════════════════════ CODE + FEATURES ══════════════════════════ */}
      <section className="relative mx-auto w-full max-w-6xl px-4 pb-28">
        <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.07]" />

        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">

          {/* Code editor */}
          <motion.div
            initial={{ opacity: 0, x: reduce ? 0 : -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="overflow-hidden rounded-3xl"
            style={{
              border: "4px solid #FF3AF2",
              boxShadow: "0 0 30px rgba(255,58,242,0.3), 8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF",
              background: "#0D0D1A",
            }}
          >
            {/* Editor top bar */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "4px solid #FFE600", background: "#1A0D2E" }}
            >
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full bg-red-500" />
                <span className="size-3 rounded-full bg-yellow-500" />
                <span className="size-3 rounded-full bg-emerald-500" />
              </div>
              <span className="font-mono text-xs font-black uppercase tracking-widest text-[#FFE600]">
                agent.js · onIdle
              </span>
              <motion.span
                className="font-mono text-[10px] font-black uppercase tracking-widest text-[#00F5D4]"
                animate={reduce ? undefined : { opacity: [1, 0.4, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                ● LIVE
              </motion.span>
            </div>

            <HighlightedCode code={SAMPLE_CODE} />

            <div
              className="px-5 py-2.5 font-mono text-[11px] text-white/45"
              style={{ borderTop: "2px dashed #FF3AF2", background: "#0A0A14" }}
            >
              <span className="font-bold text-[#00F5D4]">$</span> deeptank run agent.js{" "}
              <motion.span
                className="font-bold text-[#FF3AF2]"
                animate={reduce ? undefined : { opacity: [1, 0, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                _
              </motion.span>
            </div>
          </motion.div>

          {/* Feature cards */}
          <motion.div
            className="flex flex-col gap-5"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            <motion.div variants={fadeUp} transition={{ duration: 0.5 }} className="mb-1">
              <p className="font-mono text-sm font-black uppercase tracking-[0.4em] text-[#FF3AF2]">// engine</p>
              <h2
                className="mt-2 text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
                style={{
                  fontFamily: "var(--font-outfit)",
                  textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
                }}
              >
                为竞技而生
              </h2>
            </motion.div>

            {features.map((f, idx) => (
              <div
                key={f.title}
                style={{ transform: `rotate(${idx % 2 === 0 ? "0deg" : "-0.5deg"})` }}
              >
                <motion.div
                  variants={fadeUp}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  whileHover={reduce ? undefined : { x: 6, y: -4, transition: { duration: 0.2 } }}
                  className="overflow-hidden rounded-3xl p-6 backdrop-blur-sm"
                  style={{
                    background: "rgba(45,27,78,0.55)",
                    border: `4px ${f.borderStyle} ${f.accent}`,
                    boxShadow: `6px 6px 0 ${f.accent}60`,
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="mt-1 flex size-12 shrink-0 items-center justify-center rounded-2xl border-2"
                      style={{ borderColor: f.accent, background: `${f.accent}20` }}
                    >
                      <f.icon className="size-6" style={{ color: f.accent }} />
                    </div>
                    <div>
                      <h3
                        className="text-base font-black uppercase tracking-wide text-white"
                        style={{ textShadow: `1px 1px 0px ${f.accent}80` }}
                      >
                        {f.title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-white/55">{f.desc}</p>
                    </div>
                  </div>
                </motion.div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════ BOTTOM CTA ══════════════════════════ */}
      <section
        className="relative overflow-hidden px-4 py-32"
        style={{ borderTop: "4px solid #7B2FFF" }}
      >
        <div className="pointer-events-none absolute inset-0 pattern-mesh" />
        <div className="pointer-events-none absolute inset-0 pattern-stripes opacity-[0.07]" />

        {/* Floating shapes */}
        <div className="animate-max-float pointer-events-none absolute top-[10%] left-[6%] select-none text-5xl" aria-hidden="true">🚀</div>
        <div className="animate-max-bounce pointer-events-none absolute top-[20%] right-[8%] select-none text-5xl" aria-hidden="true">🔥</div>
        <div className="animate-max-float-reverse pointer-events-none absolute bottom-[12%] left-[12%] select-none text-4xl" aria-hidden="true">✨</div>
        <div
          className="animate-max-spin-slow pointer-events-none absolute bottom-[20%] right-[15%] size-20 rounded-full"
          style={{ border: "4px solid #FFE600", opacity: 0.2 }}
          aria-hidden="true"
        />
        <div
          className="animate-max-float pointer-events-none absolute top-[40%] left-[3%] size-14 rounded-2xl"
          style={{ border: "4px dashed #FF3AF2", opacity: 0.18 }}
          aria-hidden="true"
        />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
          className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 text-center"
        >
          <p className="font-mono text-sm font-black uppercase tracking-[0.5em] text-[#7B2FFF]">// ready ?</p>

          <h2
            className="text-5xl font-black uppercase tracking-tighter text-white md:text-7xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "4px 4px 0px #7B2FFF, 8px 8px 0px #FF3AF2, 12px 12px 0px #00F5D4",
            }}
          >
            进入战场，
            <br />
            <span className="text-gradient-max">让你的代码替你战斗</span>
          </h2>

          <p className="max-w-xl text-base font-medium text-white/55">
            注册账号，5 分钟写出第一辆坦克，立刻挑战全球玩家。
          </p>

          <motion.div whileHover={reduce ? undefined : { scale: 1.08 }} whileTap={{ scale: 0.95 }}>
            <Link
              href="/tanks"
              className="inline-flex items-center gap-2 rounded-full border-4 border-[#FFE600] px-12 py-5 text-lg font-black uppercase tracking-widest text-white transition-shadow duration-300"
              style={{
                background: "linear-gradient(135deg, #FF3AF2, #7B2FFF, #00F5D4)",
                boxShadow: "0 0 40px rgba(255,58,242,0.6), 12px 12px 0 #FFE600, 24px 24px 0 #7B2FFF",
              }}
            >
              立即创建坦克
              <ChevronRight className="size-6" />
            </Link>
          </motion.div>
        </motion.div>
      </section>

    </main>
  )
}
