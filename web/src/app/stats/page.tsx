"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Loader2, Users, Swords, Trophy, Zap } from "lucide-react"
import Link from "next/link"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// 荧光色卡片颜色循环
const ACCENT_COLORS = ["#FF3AF2", "#00F5D4", "#FFE600", "#FF6B35", "#7B2FFF"]

interface TopPlayer {
  username: string
  elo: number
  pvp_battles: number
}

interface EloDistribution {
  bronze: number
  silver: number
  gold: number
  platinum: number
  diamond: number
  master: number
  grandmaster: number
}

interface SlowQueryEntry {
  name:        string
  duration_ms: number
  ts:          number
}

interface PlatformStats {
  total_users: number
  total_agents: number
  total_battles: number
  total_pvp_battles: number
  battles_today: number
  top_players: TopPlayer[]
  elo_distribution: EloDistribution
  slow_queries: SlowQueryEntry[]
}

// 段位配置
const TIER_CONFIG = [
  { key: "bronze",      label: "青铜", color: "#c2874f" },
  { key: "silver",      label: "白银", color: "#a1a1aa" },
  { key: "gold",        label: "黄金", color: "#FFE600" },
  { key: "platinum",    label: "铂金", color: "#00F5D4" },
  { key: "diamond",     label: "钻石", color: "#FF3AF2" },
  { key: "master",      label: "大师", color: "#c084fc" },
  { key: "grandmaster", label: "王者", color: "#f43f5e" },
]

// 单个统计大数字卡片
function StatCard({
  icon: Icon,
  label,
  value,
  color,
  delay,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  value: number
  color: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="relative overflow-hidden rounded-3xl p-6"
      style={{
        background:  "#12081F",
        border:      `4px solid ${color}`,
        boxShadow:   `6px 6px 0 ${color}60`,
      }}
    >
      {/* 背景光晕 */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full opacity-10"
        style={{ background: color }}
      />
      <div className="relative flex flex-col gap-3">
        <div
          className="flex size-10 items-center justify-center rounded-xl"
          style={{ background: `${color}20`, border: `2px solid ${color}` }}
        >
          <Icon className="size-5" style={{ color }} />
        </div>
        <div>
          <p
            className="text-4xl font-black tabular-nums"
            style={{ color, textShadow: `0 0 20px ${color}60` }}
          >
            {value.toLocaleString()}
          </p>
          <p className="mt-1 text-xs font-black uppercase tracking-widest text-white/40">
            {label}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

export default function StatsPage() {
  const [stats,   setStats]   = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/stats`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<PlatformStats>
      })
      .then(data => setStats(data))
      .catch(() => setError("加载失败，请刷新重试"))
      .finally(() => setLoading(false))
  }, [])

  // 计算 Elo 分布总数，用于算百分比
  const totalDistrib = stats
    ? Object.values(stats.elo_distribution).reduce((a, b) => a + b, 0)
    : 0

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">
      {/* 背景纹理 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      {/* 漂浮装饰 */}
      <div className="animate-max-float pointer-events-none absolute top-[8%] right-[5%] select-none text-5xl" aria-hidden="true">📊</div>
      <div className="animate-max-bounce pointer-events-none absolute top-[14%] left-[4%] select-none text-4xl" aria-hidden="true">🌐</div>

      <div className="relative mx-auto w-full max-w-5xl flex flex-col gap-10">

        {/* 页面标题 */}
        <div>
          <p className="mb-2 font-mono text-xs font-black uppercase tracking-[0.4em] text-[#7B2FFF]">
            // platform stats
          </p>
          <h1
            className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
            }}
          >
            全局统计
          </h1>
          <p className="mt-2 text-sm font-medium text-white/40">
            DeepTank 平台实时数据概览
          </p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div
            className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
            style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
          >
            {error}
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-20">
            <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
            <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
          </div>
        )}

        {stats && (
          <>
            {/* ── 大数字卡片区 ── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard icon={Users}  label="注册用户"  value={stats.total_users}    color={ACCENT_COLORS[0]} delay={0} />
              <StatCard icon={Trophy} label="坦克总数"  value={stats.total_agents}   color={ACCENT_COLORS[1]} delay={0.08} />
              <StatCard icon={Swords} label="总对战场次" value={stats.total_battles}  color={ACCENT_COLORS[2]} delay={0.16} />
              <StatCard icon={Zap}    label="今日对战"  value={stats.battles_today}  color={ACCENT_COLORS[3]} delay={0.24} />
            </div>

            {/* ── 第二行：PVP 场次单独展示 ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.32 }}
              className="rounded-3xl p-6 text-center"
              style={{
                background: "#12081F",
                border:     "4px solid #7B2FFF",
                boxShadow:  "8px 8px 0 #FF3AF2, 16px 16px 0 #FFE600",
              }}
            >
              <p className="text-xs font-black uppercase tracking-[0.4em] text-[#7B2FFF]">PvP 对战场次</p>
              <p
                className="mt-2 text-6xl font-black tabular-nums text-white"
                style={{ textShadow: "2px 2px 0 #7B2FFF, 4px 4px 0 #FF3AF2" }}
              >
                {stats.total_pvp_battles.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-white/30">真人 vs 真人对战</p>
            </motion.div>

            {/* ── Elo 分布横条图 ── */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
              className="overflow-hidden rounded-3xl"
              style={{
                border:    "4px solid #00F5D4",
                boxShadow: "6px 6px 0 #7B2FFF",
              }}
            >
              {/* 标题栏 */}
              <div
                className="px-6 py-4"
                style={{ background: "#1A0D2E", borderBottom: "4px solid #00F5D4" }}
              >
                <p className="text-xs font-black uppercase tracking-widest text-[#00F5D4]">
                  // elo 段位分布
                </p>
                <h2 className="mt-1 text-xl font-black text-white">玩家段位图谱</h2>
              </div>

              <div className="flex flex-col gap-4 bg-[#0D0D1A] p-6">
                {TIER_CONFIG.map(tier => {
                  const count = stats.elo_distribution[tier.key as keyof EloDistribution] ?? 0
                  const pct   = totalDistrib > 0 ? (count / totalDistrib) * 100 : 0
                  return (
                    <div key={tier.key} className="flex items-center gap-4">
                      {/* 段位标签 */}
                      <span
                        className="w-14 shrink-0 text-right text-xs font-black uppercase tracking-wide"
                        style={{ color: tier.color }}
                      >
                        {tier.label}
                      </span>
                      {/* 进度条 */}
                      <div className="relative h-6 flex-1 overflow-hidden rounded-full bg-white/5">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: 0.5 }}
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            background: `linear-gradient(90deg, ${tier.color}AA, ${tier.color})`,
                            boxShadow:  `0 0 12px ${tier.color}60`,
                          }}
                        />
                        <span
                          className="absolute inset-0 flex items-center px-3 text-xs font-black"
                          style={{ color: pct > 20 ? "#0D0D1A" : tier.color }}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      {/* 人数 */}
                      <span
                        className="w-12 shrink-0 text-right text-sm font-black tabular-nums"
                        style={{ color: tier.color }}
                      >
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            </motion.section>

            {/* ── Top 5 玩家榜单 ── */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.52 }}
              className="overflow-hidden rounded-3xl"
              style={{
                border:    "4px solid #FFE600",
                boxShadow: "6px 6px 0 #FF3AF2",
              }}
            >
              {/* 标题栏 */}
              <div
                className="px-6 py-4"
                style={{ background: "#1A0D2E", borderBottom: "4px solid #FFE600" }}
              >
                <p className="text-xs font-black uppercase tracking-widest text-[#FFE600]">
                  // top players
                </p>
                <h2 className="mt-1 text-xl font-black text-white">Elo 天梯前五</h2>
              </div>

              <div className="bg-[#0D0D1A]">
                {stats.top_players.length === 0 ? (
                  <p className="py-10 text-center text-sm text-white/30">暂无数据</p>
                ) : (
                  stats.top_players.map((p, i) => {
                    const medal   = ["🥇","🥈","🥉"][i] ?? `#${i + 1}`
                    const color   = ACCENT_COLORS[i % ACCENT_COLORS.length]
                    return (
                      <div
                        key={p.username}
                        className="flex items-center gap-4 border-b border-white/5 px-6 py-4 last:border-b-0"
                        style={{ borderLeft: `4px solid ${color}` }}
                      >
                        <span className="text-xl w-8 text-center">{medal}</span>
                        <Link
                          href={`/dashboard`}
                          className="flex-1 font-black text-white hover:underline"
                        >
                          {p.username}
                        </Link>
                        <span
                          className="text-lg font-black tabular-nums"
                          style={{ color, textShadow: `0 0 8px ${color}60` }}
                        >
                          {Math.round(p.elo)}
                        </span>
                        <span className="text-xs font-bold text-white/30">
                          {p.pvp_battles} 场
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </motion.section>

            {/* ── 慢查询日志 ── */}
            {stats.slow_queries?.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.6 }}
                className="overflow-hidden rounded-3xl"
                style={{
                  border:    "4px solid #f43f5e",
                  boxShadow: "6px 6px 0 #c084fc",
                }}
              >
                <div
                  className="px-6 py-4"
                  style={{ background: "#1A0D2E", borderBottom: "4px solid #f43f5e" }}
                >
                  <p className="text-xs font-black uppercase tracking-widest text-[#f43f5e]">
                    // slow queries (&gt;50ms)
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white">慢查询日志</h2>
                </div>
                <div className="bg-[#0D0D1A] font-mono text-sm">
                  {stats.slow_queries.map((q, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-4 border-b border-white/5 px-6 py-3 last:border-b-0"
                    >
                      <span
                        className="w-16 shrink-0 text-right font-black tabular-nums"
                        style={{
                          color: q.duration_ms >= 500 ? "#f43f5e" : q.duration_ms >= 200 ? "#fbbf24" : "#a1a1aa",
                        }}
                      >
                        {q.duration_ms}ms
                      </span>
                      <span className="flex-1 text-white/70">{q.name}</span>
                      <span className="text-xs text-white/30">
                        {new Date(q.ts * 1000).toLocaleTimeString("zh-CN")}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
