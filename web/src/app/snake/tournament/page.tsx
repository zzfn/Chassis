"use client"

// ── 蛇王锦标赛静态展示页（赛博朋克风）────────────────────────────────

import { motion } from "framer-motion"

const CARDS = [
  {
    icon: "🏆",
    title: "单败淘汰制",
    desc: "参赛蛇两两对战，败者淘汰，胜者晋级，直至产生冠军。每场对战均在独立沙箱中实时执行，公平公正。",
    accent: "#00F5D4",
    glow: "rgba(0,245,212,0.12)",
  },
  {
    icon: "🐍",
    title: "报名条件",
    desc: "提交有效蛇代码即可报名，每位玩家限报一条蛇参赛。代码将在官方引擎中验证通过后方可入场。",
    accent: "#FFE600",
    glow: "rgba(255,230,0,0.12)",
  },
  {
    icon: "🎖️",
    title: "赛事奖励",
    desc: "冠军获得专属蛇皮肤与永久称号，积分榜额外加成。季军以上选手均可获得限定徽章留存档案。",
    accent: "#FF3AF2",
    glow: "rgba(255,58,242,0.12)",
  },
]

const SCHEDULE_SLOTS = [
  { round: "预选赛", status: "待定", note: "64 条蛇参与，淘汰至 16 强" },
  { round: "八强赛", status: "待定", note: "16 强对决，产生 8 强名单" },
  { round: "四强赛", status: "待定", note: "半决赛，决出冠亚军候选" },
  { round: "决赛",   status: "待定", note: "最终对决，蛇王诞生" },
]

export default function SnakeTournamentPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0D0D1A]">

      {/* ── 背景装饰层 ──────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />

      {/* 底部 3D 网格 */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-56 opacity-[0.10]"
        style={{
          backgroundImage: [
            "linear-gradient(transparent 94%, #00F5D4 94%)",
            "linear-gradient(90deg, transparent 94%, #00F5D4 94%)",
          ].join(", "),
          backgroundSize: "36px 36px",
          transform: "perspective(350px) rotateX(55deg) translateY(50px) scale(2.5)",
          transformOrigin: "bottom center",
          maskImage: "linear-gradient(to top, black 5%, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to top, black 5%, transparent 70%)",
        }}
      />

      {/* 顶部径向光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 size-[700px] opacity-[0.06]"
        style={{
          background: "radial-gradient(circle, #FFE600 0%, #7B2FFF 40%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">

        {/* ── Hero 区 ──────────────────────────────────────── */}
        <section className="mb-20 flex flex-col items-center text-center">

          {/* 徽章 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center gap-2 -skew-x-3 px-5 py-1.5 mb-8"
            style={{
              border: "2px solid rgba(255,230,0,0.5)",
              background: "rgba(255,230,0,0.06)",
              color: "#FFE600",
            }}
          >
            <span className="inline-block skew-x-3 font-mono text-xs font-black uppercase tracking-[0.3em]">
              ⚡ COMING_SOON.EXE
            </span>
          </motion.div>

          {/* 大标题 */}
          <motion.h1
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="text-6xl lg:text-7xl font-black uppercase tracking-tighter text-white mb-4"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "4px 4px 0 #7B2FFF, 8px 8px 0 #FFE600",
            }}
          >
            蛇王<br />锦标赛
          </motion.h1>

          {/* 副标题 */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="font-mono text-xs uppercase tracking-[0.4em] text-white/30"
          >
            &gt; TOURNAMENT_SYSTEM.LOCKED — SEASON_01.PENDING
          </motion.p>
        </section>

        {/* ── 赛事介绍卡片区 ──────────────────────────────── */}
        <section className="mb-20">
          {/* 区块标题 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.12 }}
            className="mb-8 flex items-center gap-4"
          >
            <div
              className="h-5 w-1"
              style={{ background: "linear-gradient(180deg, #00F5D4, #7B2FFF)" }}
            />
            <span className="font-mono text-[11px] font-black uppercase tracking-[0.3em] text-white/40">
              RULESET.DAT
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-3">
            {CARDS.map((card, i) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 + i * 0.06 }}
                className="overflow-hidden"
                style={{
                  border: `2px solid ${card.accent}40`,
                  borderTop: `2px solid ${card.accent}`,
                  background: "rgba(0,0,0,0.6)",
                  boxShadow: `0 0 20px ${card.glow}`,
                }}
              >
                {/* Chrome 标题栏 */}
                <div
                  className="flex items-center gap-3 px-4 py-2 border-b-2"
                  style={{
                    background: `${card.accent}0a`,
                    borderColor: `${card.accent}60`,
                  }}
                >
                  <span className="text-xl">{card.icon}</span>
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.3em]"
                    style={{ color: card.accent }}
                  >
                    {card.title.replace(/\s/g, "_")}.DAT
                  </span>
                </div>

                <div className="p-5">
                  <p className="text-sm leading-relaxed text-white/55">{card.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── 赛程时间线 ──────────────────────────────────── */}
        <section className="mb-20">
          {/* 区块标题 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="mb-8 flex items-center gap-4"
          >
            <div
              className="h-5 w-1"
              style={{ background: "linear-gradient(180deg, #FFE600, #FF3AF2)" }}
            />
            <span className="font-mono text-[11px] font-black uppercase tracking-[0.3em] text-white/40">
              SCHEDULE.SYS
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-1"
              style={{
                border: "1px dashed rgba(0,245,212,0.35)",
                background: "rgba(0,245,212,0.06)",
                color: "#00F5D4",
              }}
            >
              S1 赛季
            </span>
          </motion.div>

          {/* 时间线节点列表 */}
          <div className="relative pl-10">
            {/* 竖线 */}
            <div
              className="absolute left-[18px] top-3 bottom-3 border-l-2 border-dashed"
              style={{ borderColor: "rgba(255,255,255,0.10)" }}
            />

            <div className="space-y-4">
              {SCHEDULE_SLOTS.map((slot, idx) => (
                <motion.div
                  key={slot.round}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.33 + idx * 0.06 }}
                  className="relative flex items-start gap-5 px-5 py-4"
                  style={{
                    border: "2px solid rgba(255,255,255,0.06)",
                    borderLeft: "2px solid rgba(255,230,0,0.25)",
                    background: "rgba(0,0,0,0.4)",
                  }}
                >
                  {/* 节点圆 —— 绝对定位到竖线上 */}
                  <div
                    className="absolute -left-[30px] top-1/2 -translate-y-1/2 flex size-7 items-center justify-center font-mono text-xs font-black"
                    style={{
                      border: "2px solid rgba(255,230,0,0.45)",
                      background: "#0D0D1A",
                      color: "#FFE600",
                    }}
                  >
                    {idx + 1}
                  </div>

                  {/* 内容 */}
                  <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="block font-mono text-sm font-black uppercase tracking-wider text-white/80">
                        {slot.round}
                      </span>
                      <span className="font-mono text-xs text-white/35">{slot.note}</span>
                    </div>

                    {/* 待定 badge */}
                    <span
                      className="font-mono text-[10px] font-black uppercase tracking-[0.25em] px-3 py-1"
                      style={{
                        border: "1px dashed rgba(255,230,0,0.4)",
                        background: "rgba(255,230,0,0.05)",
                        color: "#FFE600",
                      }}
                    >
                      {slot.status}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* 下一届提示 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.58 }}
            className="mt-6 flex items-center gap-4 px-5 py-4"
            style={{
              border: "2px solid rgba(0,245,212,0.2)",
              borderLeft: "2px solid #00F5D4",
              background: "rgba(0,245,212,0.04)",
            }}
          >
            <span className="font-mono text-lg">📅</span>
            <div className="flex-1">
              <p className="font-mono text-xs font-black uppercase tracking-[0.25em]" style={{ color: "#00F5D4" }}>
                下一届赛事筹备中
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-white/30">
                赛程确定后将第一时间公告，请保持关注
              </p>
            </div>
            <span
              className="block size-2 flex-shrink-0 rounded-full"
              style={{
                background: "#00F5D4",
                boxShadow: "0 0 8px #00F5D4",
                animation: "pulse-dot 2s ease-in-out infinite",
              }}
            />
          </motion.div>
        </section>

        {/* ── 报名按钮区 ──────────────────────────────────── */}
        <section className="flex flex-col items-center">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.62 }}
            className="mb-5 font-mono text-[11px] uppercase tracking-[0.3em] text-white/25"
          >
            赛事开放报名时，你将可以在此直接提交参赛蛇
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.66 }}
            className="flex flex-col items-center"
          >
            <motion.button
              disabled
              className="-skew-x-3 w-full max-w-xs font-mono font-black uppercase cursor-not-allowed"
              style={{
                height: 56,
                border: "2px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.03)",
                letterSpacing: "0.35em",
              }}
            >
              <span className="inline-block skew-x-3">REGISTRATION.LOCKED</span>
            </motion.button>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/20">
              功能即将开放
            </p>
          </motion.div>
        </section>

      </div>

      {/* ── keyframes ────────────────────────────────────── */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </main>
  )
}
