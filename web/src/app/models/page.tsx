"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Loader2, Trophy, Zap, Users, Target, TrendingUp } from "lucide-react"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

interface ModelEntry {
  model: string
  tank_count: number
  user_count: number
  avg_elo: number
  total_elo: number
  total_wins: number
  total_battles: number
}

const MODEL_META: Record<string, { icon: string; color: string; glow: string; label?: string }> = {
  Claude:  { icon: "/ai-icons/claude.ico",  color: "#FF9066", glow: "#FF906650", label: "Claude" },
  GPT:     { icon: "/ai-icons/gpt.ico",     color: "#10A37F", glow: "#10A37F50", label: "GPT" },
  Copilot: { icon: "/ai-icons/copilot.ico", color: "#4B9EFF", glow: "#4B9EFF50", label: "Copilot" },
  Gemini:  { icon: "/ai-icons/gemini.ico",  color: "#4285F4", glow: "#4285F450", label: "Gemini" },
  Cursor:  { icon: "/ai-icons/cursor.ico",  color: "#00D4AA", glow: "#00D4AA50", label: "Cursor" },
  Other:   { icon: "",                       color: "#a1a1aa", glow: "#a1a1aa30", label: "其他 AI" },
}

const RANK_MEDALS = ["🥇", "🥈", "🥉"]

function ModelIcon({ model, size = 28 }: { model: string; size?: number }) {
  const meta = MODEL_META[model]
  if (meta?.icon) {
    return (
      <img
        src={meta.icon}
        width={size}
        height={size}
        alt={model}
        className="rounded-md"
        style={{ boxShadow: `0 0 8px ${meta.glow}` }}
      />
    )
  }
  return <span style={{ fontSize: size * 0.8 }}>🤖</span>
}

function WinRateBar({ wins, battles, color }: { wins: number; battles: number; color: string }) {
  const rate = battles > 0 ? wins / battles : 0
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-24 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${rate * 100}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <span className="w-10 text-right text-xs font-bold" style={{ color }}>
        {battles > 0 ? Math.round(rate * 100) : 0}%
      </span>
    </div>
  )
}

export default function ModelsPage() {
  const [entries, setEntries] = useState<ModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/models/leaderboard`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setEntries(Array.isArray(data) ? data : [])
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false))
  }, [])

  const topModel = entries[0]

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      <div className="animate-max-float pointer-events-none absolute top-[6%] right-[4%] select-none text-5xl" aria-hidden="true">🤖</div>
      <div className="animate-max-bounce pointer-events-none absolute top-[12%] left-[3%] select-none text-4xl" aria-hidden="true">⚡</div>

      <div className="relative mx-auto w-full max-w-5xl flex flex-col gap-8">

        {/* 标题 */}
        <div>
          <p className="mb-2 font-mono text-xs font-black uppercase tracking-[0.4em] text-[#FF3AF2]">
            AI MODEL
          </p>
          <h1
            className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
            }}
          >
            模型排行榜
          </h1>
          <p className="mt-2 text-sm font-medium text-white/40">
            按 AI 模型聚合所有坦克的平均 Elo，看哪家 AI 写的坦克最强。
          </p>
        </div>

        {error && (
          <div
            className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
            style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
          >
            {error}
          </div>
        )}

        {/* 冠军卡片 */}
        {!loading && topModel && (() => {
          const meta = MODEL_META[topModel.model] ?? MODEL_META["Other"]
          const winRate = topModel.total_battles > 0
            ? Math.round((topModel.total_wins / topModel.total_battles) * 100)
            : 0
          return (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="relative overflow-hidden rounded-3xl p-6"
              style={{
                background: `linear-gradient(135deg, #1A0D2E 0%, ${meta.color}18 100%)`,
                border: `4px solid ${meta.color}`,
                boxShadow: `8px 8px 0 ${meta.glow}, 0 0 40px ${meta.glow}`,
              }}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-4xl">🥇</div>
                  <ModelIcon model={topModel.model} size={52} />
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-white/40">当前冠军</p>
                    <h2 className="text-3xl font-black text-white" style={{ textShadow: `0 0 20px ${meta.color}` }}>
                      {meta.label ?? topModel.model}
                    </h2>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-3">
                  {[
                    { icon: <TrendingUp className="size-4" />, label: "平均 Elo", value: Math.round(topModel.avg_elo) },
                    { icon: <Target className="size-4" />,     label: "胜率",     value: `${winRate}%` },
                    { icon: <Users className="size-4" />,      label: "坦克数",   value: topModel.tank_count },
                  ].map(stat => (
                    <div key={stat.label} className="flex flex-col items-center gap-1">
                      <span style={{ color: meta.color }}>{stat.icon}</span>
                      <span className="text-2xl font-black text-white">{stat.value}</span>
                      <span className="text-xs text-white/40">{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )
        })()}

        {/* 排行表 */}
        <div
          className="overflow-hidden rounded-3xl"
          style={{
            border: "4px solid #FF3AF2",
            boxShadow: "8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF",
          }}
        >
          <div
            className="hidden sm:grid grid-cols-[64px_1fr_110px_100px_100px_120px] items-center px-5 py-3 text-xs font-black uppercase tracking-widest"
            style={{ borderBottom: "4px solid #FFE600", background: "#1A0D2E", color: "#FF3AF2" }}
          >
            <span>排名</span>
            <span>模型</span>
            <span className="text-right">平均 Elo</span>
            <span className="text-right">坦克数</span>
            <span className="text-right">用户数</span>
            <span className="text-right">胜率</span>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-3 py-20 bg-[#0D0D1A]">
              <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
              <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-20 bg-[#0D0D1A]">
              <span className="text-5xl animate-max-bounce" aria-hidden="true">🤖</span>
              <p className="text-sm font-black uppercase tracking-widest text-white/40">
                暂无数据 — 提交坦克时请选择使用的 AI 模型
              </p>
            </div>
          )}

          <div className="bg-[#0D0D1A]">
            {entries.map((entry, idx) => {
              const meta = MODEL_META[entry.model] ?? MODEL_META["Other"]
              const winRate = entry.total_battles > 0
                ? Math.round((entry.total_wins / entry.total_battles) * 100)
                : 0
              const rankColor =
                idx === 0 ? "#FFE600" :
                idx === 1 ? "#a1a1aa" :
                idx === 2 ? "#c2874f" : "#4b5563"

              const rowBg = idx < 3
                ? `rgba(${idx === 0 ? "255,230,0" : idx === 1 ? "161,161,170" : "194,135,79"},0.04)`
                : "transparent"

              return (
                <motion.div
                  key={entry.model}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(idx * 0.06, 0.5) }}
                  className="grid grid-cols-[64px_1fr_110px_100px_100px_120px] items-center px-5 py-4 transition-colors duration-150"
                  style={{
                    background: rowBg,
                    borderBottom: "2px solid rgba(45,27,78,0.8)",
                    borderLeft: `4px solid ${idx < 3 ? rankColor : "transparent"}`,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = `${meta.color}10`
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = rowBg
                  }}
                >
                  {/* 排名 */}
                  <div className="flex items-center">
                    {idx < 3
                      ? <span className="text-xl">{RANK_MEDALS[idx]}</span>
                      : <span className="text-base font-black" style={{ color: rankColor }}>#{idx + 1}</span>
                    }
                  </div>

                  {/* 模型 */}
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-12 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background: `${meta.color}18`,
                        border: `2px solid ${meta.color}60`,
                        boxShadow: `0 0 10px ${meta.glow}`,
                      }}
                    >
                      <ModelIcon model={entry.model} size={28} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-black text-white" style={{ color: meta.color }}>
                        {meta.label ?? entry.model}
                      </span>
                      <span className="text-xs text-white/30">
                        {entry.total_battles} 场对战 · {entry.total_wins} 胜
                      </span>
                    </div>
                  </div>

                  {/* 平均 Elo */}
                  <span
                    className="text-right text-base font-black"
                    style={{ color: meta.color, textShadow: `0 0 8px ${meta.glow}` }}
                  >
                    {Math.round(entry.avg_elo)}
                  </span>

                  {/* 坦克数 */}
                  <div className="flex items-center justify-end gap-1">
                    <Zap className="size-3 text-white/30" />
                    <span className="text-base font-black text-white">{entry.tank_count}</span>
                  </div>

                  {/* 用户数 */}
                  <div className="flex items-center justify-end gap-1">
                    <Users className="size-3 text-white/30" />
                    <span className="text-base font-black text-white">{entry.user_count}</span>
                  </div>

                  {/* 胜率 */}
                  <div className="flex justify-end">
                    <WinRateBar wins={entry.total_wins} battles={entry.total_battles} color={meta.color} />
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* 说明 */}
        {!loading && entries.length > 0 && (
          <p className="text-center text-xs text-white/20">
            数据聚合自所有用户提交坦克时选择的 AI 模型 · 按平均 Elo 排序
          </p>
        )}
      </div>
    </main>
  )
}
