"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { Loader2, Trophy, Swords } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import { getEloTier } from "@/lib/elo"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

interface PlayerEntry {
  agent_id: string
  agent_name: string
  owner: string
  pvp_battles: number
  pvp_wins: number
  pvp_losses: number
  elo: number
}

const PERIOD_ACCENTS: Record<Period, string> = {
  today: "#FF3AF2",
  week:  "#00F5D4",
  all:   "#FFE600",
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "今日",
  week:  "本周",
  all:   "历史总榜",
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "elo",     label: "Elo 分"  },
  { value: "winRate", label: "胜率"    },
  { value: "wins",    label: "胜场数"  },
  { value: "battles", label: "总场次"  },
]

const RANK_MEDALS = ["🥇", "🥈", "🥉"]

type SortKey = "elo" | "winRate" | "wins" | "battles"
type Period  = "today" | "week" | "all"

function TankAvatar({ name }: { name: string }) {
  const initials = name.slice(0, 2).toUpperCase()
  const hue      = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  const color    = `hsl(${hue}, 70%, 60%)`
  return (
    <div
      className="flex size-12 shrink-0 items-center justify-center rounded-full border-4 text-sm font-black text-white"
      style={{
        background:  `hsl(${hue}, 40%, 15%)`,
        borderColor: color,
        boxShadow:   `0 0 12px ${color}60`,
      }}
    >
      {initials}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [myUsername, setMyUsername] = useState("")
  const [players,    setPlayers]    = useState<PlayerEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [period,     setPeriod]     = useState<Period>("all")
  const [sortBy,     setSortBy]     = useState<SortKey>("elo")

  useEffect(() => { setMyUsername(getCookie("username") ?? "") }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${apiBase}/api/players?period=${period}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setPlayers(Array.isArray(data) ? data : [])
        if (!Array.isArray(data)) setError("返回数据异常")
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false))
  }, [period])

  const sorted = [...players].sort((a, b) => {
    if (sortBy === "elo")     return (b.elo ?? 1000) - (a.elo ?? 1000)
    if (sortBy === "wins")    return b.pvp_wins - a.pvp_wins
    if (sortBy === "battles") return b.pvp_battles - a.pvp_battles
    const rA = a.pvp_battles > 0 ? a.pvp_wins / a.pvp_battles : 0
    const rB = b.pvp_battles > 0 ? b.pvp_wins / b.pvp_battles : 0
    return rB - rA || b.pvp_wins - a.pvp_wins
  })

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">

      {/* Background patterns */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      {/* Floating decorations */}
      <div className="animate-max-float pointer-events-none absolute top-[6%] right-[4%] select-none text-5xl" aria-hidden="true">🏆</div>
      <div className="animate-max-bounce pointer-events-none absolute top-[12%] left-[3%] select-none text-4xl" aria-hidden="true">⚡</div>
      <div
        className="animate-max-spin-slow pointer-events-none absolute bottom-[10%] right-[3%] size-16 rounded-full"
        style={{ border: "4px solid #FFE600", opacity: 0.18 }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-5xl flex flex-col gap-8">

        {/* ── Page header ── */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 font-mono text-xs font-black uppercase tracking-[0.4em] text-[#7B2FFF]">
              // leaderboard
            </p>
            <h1
              className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
              style={{
                fontFamily:  "var(--font-outfit)",
                textShadow:  "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
              }}
            >
              排行榜
            </h1>
            <p className="mt-2 text-sm font-medium text-white/40">
              追踪今日晋升、本周黑马与历史总榜冠军。
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Period pills */}
            <div className="flex gap-2">
              {(["today", "week", "all"] as Period[]).map(p => {
                const color  = PERIOD_ACCENTS[p]
                const active = period === p
                return (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="flex items-center gap-1.5 rounded-full border-4 px-4 py-1.5 text-xs font-black uppercase tracking-widest transition-all duration-200 hover:scale-105 active:scale-95"
                    style={
                      active
                        ? { borderColor: color, background: `${color}22`, color, boxShadow: `0 0 12px ${color}50` }
                        : { borderStyle: "dashed", borderColor: `${color}50`, color: `${color}80` }
                    }
                  >
                    {p === "all" && <Trophy className="size-3" />}
                    {PERIOD_LABELS[p]}
                  </button>
                )
              })}
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="appearance-none rounded-full border-4 border-dashed border-[#7B2FFF] bg-[#2D1B4E]/60 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-[#7B2FFF] focus:outline-none cursor-pointer"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
            style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
          >
            {error}
          </div>
        )}

        {/* ── Leaderboard table ── */}
        <div
          className="overflow-hidden rounded-3xl"
          style={{
            border:     "4px solid #FF3AF2",
            boxShadow:  "8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF",
          }}
        >
          {/* Table header */}
          <div
            className="hidden sm:grid grid-cols-[64px_1fr_100px_80px_80px_180px] items-center px-5 py-3 text-xs font-black uppercase tracking-widest"
            style={{ borderBottom: "4px solid #FFE600", background: "#1A0D2E", color: "#FF3AF2" }}
          >
            <span>排名</span>
            <span>坦克</span>
            <span className="text-right">Elo</span>
            <span className="text-right">胜场</span>
            <span className="text-right">胜率</span>
            <span className="text-right">操作</span>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-3 py-20 bg-[#0D0D1A]">
              <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
              <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
            </div>
          )}

          {/* Empty */}
          {!loading && sorted.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-20 bg-[#0D0D1A]">
              <span className="text-5xl animate-max-bounce" aria-hidden="true">🎯</span>
              <p className="text-sm font-black uppercase tracking-widest text-white/40">
                暂无数据，去{" "}
                <Link
                  href="/race"
                  className="text-[#00F5D4] underline-offset-4 hover:underline"
                >
                  竞技场
                </Link>
                {" "}提交你的第一个坦克
              </p>
            </div>
          )}

          {/* Rows */}
          <div className="bg-[#0D0D1A]">
            {sorted.map((p, idx) => {
              const winRate = p.pvp_battles > 0 ? Math.round((p.pvp_wins / p.pvp_battles) * 100) : 0
              const elo     = Math.round(p.elo ?? 1000)
              const tier    = getEloTier(p.elo ?? 1000, p.pvp_battles)
              const isMe    = p.owner === myUsername
              const isTop3  = idx < 3

              const rankColor =
                idx === 0 ? "#FFE600" :
                idx === 1 ? "#a1a1aa" :
                idx === 2 ? "#c2874f" : "#4b5563"

              const rowBg = isMe
                ? "rgba(123,47,255,0.12)"
                : isTop3
                ? `rgba(${idx === 0 ? "255,230,0" : idx === 1 ? "161,161,170" : "194,135,79"},0.04)`
                : "transparent"

              const leftBorder = isMe
                ? "#7B2FFF"
                : isTop3
                ? rankColor
                : "transparent"

              return (
                <motion.div
                  key={p.agent_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.4) }}
                  className="grid grid-cols-[64px_1fr_100px_80px_80px_180px] items-center px-5 py-4 transition-colors duration-150"
                  style={{
                    background:  rowBg,
                    borderBottom: "2px solid rgba(45,27,78,0.8)",
                    borderLeft:   `4px solid ${leftBorder}`,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,58,242,0.06)"
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = rowBg
                  }}
                >
                  {/* Rank */}
                  <div className="flex items-center gap-1">
                    {isTop3 ? (
                      <span className="text-xl">{RANK_MEDALS[idx]}</span>
                    ) : (
                      <span
                        className="text-base font-black"
                        style={{ color: rankColor }}
                      >
                        #{idx + 1}
                      </span>
                    )}
                  </div>

                  {/* Tank info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <TankAvatar name={p.agent_name} />
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-white truncate">{p.agent_name}</span>
                        {isMe && (
                          <span
                            className="shrink-0 rounded-full border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                            style={{ borderColor: "#7B2FFF", color: "#7B2FFF", background: "rgba(123,47,255,0.15)" }}
                          >
                            我
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-white/40 truncate">
                        {p.owner} · <span style={{ color: tier.color }}>{tier.label}</span> · {p.pvp_battles} 场
                      </span>
                    </div>
                  </div>

                  {/* Elo */}
                  <span
                    className="text-right text-base font-black"
                    style={{ color: tier.color, textShadow: `0 0 8px ${tier.color}60` }}
                  >
                    {elo}
                  </span>

                  {/* Wins */}
                  <span className="text-right text-base font-black text-white">{p.pvp_wins}</span>

                  {/* Win rate */}
                  <span className="text-right text-sm font-bold text-white/50">{winRate}%</span>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/tanks/${p.agent_id}`}
                      className="rounded-full border-4 border-dashed border-[#00F5D4] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#00F5D4] transition-all duration-150 hover:bg-[#00F5D4]/10 hover:scale-105"
                    >
                      详情
                    </Link>
                    {!isMe && (
                      <button
                        onClick={() => router.push(`/race?opponent=${p.agent_id}`)}
                        className="flex items-center gap-1 rounded-full border-4 border-[#FFE600] px-3 py-1 text-xs font-black uppercase tracking-wide text-white transition-all duration-200 hover:scale-105 active:scale-95"
                        style={{
                          background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                          boxShadow:  "0 0 10px rgba(255,58,242,0.3), 2px 2px 0 #FFE600",
                        }}
                      >
                        <Swords className="size-3" />
                        挑战
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </main>
  )
}
