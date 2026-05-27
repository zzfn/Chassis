"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, ArrowLeft, Lock, Trophy } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import { getEloTier } from "@/lib/elo"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

interface Tank {
  agent_id: string
  agent_name: string
  pvp_wins?: number
  pvp_losses?: number
  pvp_battles?: number
  elo?: number
  is_active?: boolean
}

interface AchievementDef {
  label: string
  icon: string
  desc: string
  color: string
  check: (s: Stats) => boolean
  progress?: (s: Stats) => { value: number; max: number; label: string }
}

interface Stats {
  totalWins: number
  totalLosses: number
  totalBattles: number
  winRate: number
  bestElo: number
  bestEloBattles: number
  bestZeroLossBattles: number
  perfectTanks: number
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    label: "初露锋芒",
    icon: "🌟",
    desc: "累计赢得 10 场对战",
    color: "#FFE600",
    check: s => s.totalWins >= 10,
    progress: s => ({ value: Math.min(s.totalWins, 10), max: 10, label: `${s.totalWins}/10 胜` }),
  },
  {
    label: "沙场老将",
    icon: "⚔️",
    desc: "累计赢得 50 场对战",
    color: "#FF6B35",
    check: s => s.totalWins >= 50,
    progress: s => ({ value: Math.min(s.totalWins, 50), max: 50, label: `${s.totalWins}/50 胜` }),
  },
  {
    label: "百战百胜",
    icon: "🏆",
    desc: "累计赢得 100 场对战",
    color: "#FF3AF2",
    check: s => s.totalWins >= 100,
    progress: s => ({ value: Math.min(s.totalWins, 100), max: 100, label: `${s.totalWins}/100 胜` }),
  },
  {
    label: "久经沙场",
    icon: "🔥",
    desc: "累计参与 50 场对战",
    color: "#FF6B35",
    check: s => s.totalBattles >= 50,
    progress: s => ({ value: Math.min(s.totalBattles, 50), max: 50, label: `${s.totalBattles}/50 场` }),
  },
  {
    label: "征战百场",
    icon: "⚡",
    desc: "累计参与 100 场对战",
    color: "#FFE600",
    check: s => s.totalBattles >= 100,
    progress: s => ({ value: Math.min(s.totalBattles, 100), max: 100, label: `${s.totalBattles}/100 场` }),
  },
  {
    label: "战无不胜",
    icon: "🛡️",
    desc: "20 场以上胜率达到 70%",
    color: "#00F5D4",
    check: s => s.totalBattles >= 20 && s.winRate >= 70,
    progress: s => s.totalBattles < 20
      ? { value: s.totalBattles, max: 20, label: `${s.totalBattles}/20 场（需先打满 20 场）` }
      : { value: Math.min(s.winRate, 70), max: 70, label: `${s.winRate}% 胜率（需≥70%）` },
  },
  {
    label: "全胜将军",
    icon: "👑",
    desc: "单只坦克 5 场以上全胜",
    color: "#7B2FFF",
    check: s => s.perfectTanks > 0,
    progress: s => ({ value: Math.min(s.bestZeroLossBattles, 5), max: 5, label: `最佳全胜坦克 ${s.bestZeroLossBattles}/5 场` }),
  },
  {
    label: "钻石荣耀",
    icon: "💎",
    desc: "任意坦克 ELO 达到 1800",
    color: "#818cf8",
    check: s => s.bestElo >= 1800,
    progress: s => ({ value: Math.min(s.bestElo, 1800), max: 1800, label: `最高 ${s.bestElo}/1800 ELO` }),
  },
  {
    label: "铂金精英",
    icon: "🔷",
    desc: "任意坦克 ELO 达到 1500",
    color: "#67e8f9",
    check: s => s.bestElo >= 1500,
    progress: s => ({ value: Math.min(s.bestElo, 1500), max: 1500, label: `最高 ${s.bestElo}/1500 ELO` }),
  },
]

function computeStats(tanks: Tank[]): Stats {
  let totalWins = 0, totalLosses = 0, totalBattles = 0, bestElo = 0
  let bestEloBattles = 0, perfectTanks = 0, bestZeroLossBattles = 0

  for (const t of tanks) {
    const w = t.pvp_wins ?? 0
    const l = t.pvp_losses ?? 0
    const b = t.pvp_battles ?? 0
    const elo = t.elo ?? 0
    totalWins    += w
    totalLosses  += l
    totalBattles += b
    if (elo > bestElo) { bestElo = elo; bestEloBattles = b }
    if (l === 0 && b > bestZeroLossBattles) bestZeroLossBattles = b
    if (b >= 5 && l === 0) perfectTanks++
  }

  const winRate = totalBattles > 0 ? Math.round((totalWins / totalBattles) * 100) : 0
  return { totalWins, totalLosses, totalBattles, winRate, bestElo, bestEloBattles, bestZeroLossBattles, perfectTanks }
}

export default function AchievementsPage() {
  const router = useRouter()
  const [tanks,   setTanks]   = useState<Tank[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    fetch(`${apiBase}/api/my-tanks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error("加载失败"); return r.json() })
      .then(setTanks)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [router])

  if (loading) return (
    <main className="flex flex-1 items-center justify-center" style={{ background: "#0D0D1A" }}>
      <Loader2 className="size-8 animate-spin text-[#FF3AF2]" />
    </main>
  )

  if (error) return (
    <main className="flex flex-1 items-center justify-center" style={{ background: "#0D0D1A" }}>
      <p className="font-black text-[#FF6B35]">{error}</p>
    </main>
  )

  const stats = computeStats(tanks)
  const unlocked = ACHIEVEMENT_DEFS.filter(a => a.check(stats))
  const locked   = ACHIEVEMENT_DEFS.filter(a => !a.check(stats))
  const bestTier = getEloTier(stats.bestElo, stats.bestEloBattles)

  return (
    <main
      className="min-h-screen"
      style={{
        background: "#0D0D1A",
        backgroundImage: "radial-gradient(circle at 20% 20%, rgba(123,47,255,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(255,58,242,0.08) 0%, transparent 50%)",
      }}
    >
      <div className="mx-auto max-w-4xl px-4 py-10">

        {/* 返回 */}
        <Link
          href="/tanks"
          className="inline-flex items-center gap-1.5 border-2 border-white/20 bg-white/5 px-3 py-1.5 text-sm font-bold text-white/60 transition-all duration-100 hover:border-[#FF3AF2] hover:text-[#FF3AF2]"
        >
          <ArrowLeft className="size-4" /> 我的坦克
        </Link>

        {/* 标题 */}
        <div className="mt-8 mb-10">
          <h1
            className="text-4xl font-black uppercase tracking-tight text-white"
            style={{ textShadow: "3px 3px 0 #FF3AF2" }}
          >
            成就
          </h1>
          <p className="mt-1 text-sm font-bold text-white/40">
            {unlocked.length}/{ACHIEVEMENT_DEFS.length} 已解锁
          </p>
        </div>

        {/* 总览数据 */}
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "总胜场",  value: stats.totalWins,    color: "#00F5D4" },
            { label: "总场次",  value: stats.totalBattles, color: "#FFE600" },
            { label: "胜率",    value: `${stats.winRate}%`, color: "#FF6B35" },
            { label: "最高段位", value: bestTier.label,     color: bestTier.color },
          ].map(c => (
            <div
              key={c.label}
              className="border-2 border-white/10 bg-white/5 p-4 text-center"
              style={{ boxShadow: `0 0 16px ${c.color}20` }}
            >
              <p className="text-2xl font-black" style={{ color: c.color }}>{c.value}</p>
              <p className="mt-0.5 text-xs font-bold text-white/40">{c.label}</p>
            </div>
          ))}
        </div>

        {/* 已解锁 */}
        {unlocked.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white/50">
              <Trophy className="size-4" /> 已解锁 · {unlocked.length}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {unlocked.map(a => (
                <div
                  key={a.label}
                  className="flex items-center gap-4 border-2 bg-white/5 p-4 transition-all duration-200 hover:bg-white/10"
                  style={{ borderColor: `${a.color}60`, boxShadow: `4px 4px 0 ${a.color}40` }}
                >
                  <span className="text-3xl">{a.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-white" style={{ textShadow: `1px 1px 0 ${a.color}` }}>
                      {a.label}
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-white/40">{a.desc}</p>
                  </div>
                  <div
                    className="shrink-0 border-2 px-2 py-0.5 text-xs font-black uppercase tracking-widest"
                    style={{ borderColor: a.color, color: a.color }}
                  >
                    解锁
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 待解锁 */}
        {locked.length > 0 && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white/30">
              <Lock className="size-4" /> 待解锁 · {locked.length}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {locked.map(a => {
                const prog = a.progress?.(stats)
                const pct  = prog ? Math.round((prog.value / prog.max) * 100) : 0
                return (
                  <div
                    key={a.label}
                    className="flex flex-col gap-3 border-2 border-white/10 bg-white/[0.03] p-4 opacity-60"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-3xl grayscale">{a.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-white/50">{a.label}</p>
                        <p className="mt-0.5 text-xs font-bold text-white/30">{a.desc}</p>
                      </div>
                      <Lock className="size-4 shrink-0 text-white/20" />
                    </div>
                    {prog && (
                      <div>
                        <div className="mb-1 flex justify-between text-xs font-bold text-white/30">
                          <span>{prog.label}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden bg-white/10">
                          <div
                            className="h-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: a.color, opacity: 0.5 }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* 空状态：只在没有任何坦克时展示，有坦克时用「待解锁」section 引导 */}
        {tanks.length === 0 && (
          <div className="mt-4 border-2 border-dashed border-white/10 p-10 text-center">
            <p className="text-4xl">🎯</p>
            <p className="mt-3 font-black text-white/40">还没有解锁任何成就</p>
            <p className="mt-1 text-sm text-white/25">去竞技场打几场试试</p>
            <Link
              href="/race"
              className="mt-5 inline-flex items-center gap-2 border-2 border-[#FF3AF2] px-5 py-2.5 text-sm font-black text-[#FF3AF2] transition-all duration-150 hover:bg-[#FF3AF2] hover:text-black"
            >
              进入竞技场
            </Link>
          </div>
        )}

      </div>
    </main>
  )
}
