"use client"

import { useEffect, useState, useCallback } from "react"
import { motion } from "framer-motion"
import { Loader2 } from "lucide-react"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── 类型定义 ─────────────────────────────────────────────────
interface SnakePlayerEntry {
  agent_id: string
  agent_name: string
  owner: string
  pvp_battles: number
  pvp_wins: number
  version: number
  elo: number
}

// ── 排名徽章 ─────────────────────────────────────────────────
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span
        className="inline-flex items-center justify-center w-8 h-8 font-mono font-black text-sm"
        style={{
          background: "rgba(255,230,0,0.12)",
          color: "#FFE600",
          border: "1px solid rgba(255,230,0,0.4)",
          boxShadow: "0 0 8px rgba(255,230,0,0.15)",
        }}
        aria-label="第一名"
      >
        1
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span
        className="inline-flex items-center justify-center w-8 h-8 font-mono font-black text-sm"
        style={{
          background: "rgba(192,192,192,0.1)",
          color: "#C0C0C0",
          border: "1px solid rgba(192,192,192,0.35)",
        }}
        aria-label="第二名"
      >
        2
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span
        className="inline-flex items-center justify-center w-8 h-8 font-mono font-black text-sm"
        style={{
          background: "rgba(205,127,50,0.12)",
          color: "#CD7F32",
          border: "1px solid rgba(205,127,50,0.35)",
        }}
        aria-label="第三名"
      >
        3
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 font-mono text-sm"
      style={{ color: "rgba(255,255,255,0.4)" }}
    >
      {rank}
    </span>
  )
}

// ── 胜率颜色 ─────────────────────────────────────────────────
function winRateColor(rate: number): string {
  if (rate >= 0.6) return "#00F5D4"
  if (rate >= 0.4) return "#FFE600"
  return "#ffffff"
}

// ── 胜率显示 ─────────────────────────────────────────────────
function WinRate({ wins, battles }: { wins: number; battles: number }) {
  if (battles === 0) {
    return <span style={{ color: "rgba(255,255,255,0.35)" }}>—</span>
  }
  const rate = wins / battles
  const pct = (rate * 100).toFixed(1)
  return (
    <span style={{ color: winRateColor(rate), fontWeight: 600 }}>
      {pct}%
    </span>
  )
}

// ── 表头单元格 ────────────────────────────────────────────────
function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode
  align?: "left" | "right" | "center"
  className?: string
}) {
  return (
    <th
      className={`font-mono uppercase tracking-widest ${className}`}
      style={{
        padding: "10px 16px",
        textAlign: align,
        fontSize: "11px",
        fontWeight: 700,
        color: "rgba(0,245,212,0.6)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  )
}

// ── 表格行 ────────────────────────────────────────────────────
function TableRow({ player, rank }: { player: SnakePlayerEntry; rank: number }) {
  const [hovered, setHovered] = useState(false)

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: "1px solid rgba(0,245,212,0.06)",
        background: hovered ? "rgba(0,245,212,0.04)" : "transparent",
        transition: "background 0.15s ease",
      }}
    >
      {/* 排名 */}
      <td style={{ padding: "14px 16px", width: "60px" }}>
        <RankBadge rank={rank} />
      </td>

      {/* 蛇名 */}
      <td style={{ padding: "14px 16px" }}>
        <span
          className="font-mono"
          style={{
            fontWeight: 700,
            fontSize: "0.95rem",
            color: rank <= 3 ? "#ffffff" : "rgba(255,255,255,0.85)",
          }}
        >
          {player.agent_name}
        </span>
      </td>

      {/* 持有者（窄屏隐藏） */}
      <td
        className="hidden sm:table-cell font-mono"
        style={{ padding: "14px 16px", color: "rgba(255,255,255,0.4)", fontSize: "0.85rem" }}
      >
        {player.owner}
      </td>

      {/* ELO */}
      <td style={{ padding: "14px 16px", textAlign: "right" }}>
        <span className="font-mono font-black" style={{ color: "#7B2FFF" }}>
          {Math.round(player.elo ?? 1500)}
        </span>
      </td>

      {/* 胜场 */}
      <td style={{ padding: "14px 16px", textAlign: "right" }}>
        <span className="font-mono font-black" style={{ color: "#00F5D4" }}>
          {player.pvp_wins}
        </span>
      </td>

      {/* 场次（中屏以上显示） */}
      <td
        className="hidden md:table-cell font-mono"
        style={{ padding: "14px 16px", textAlign: "right", color: "rgba(255,255,255,0.45)", fontSize: "0.88rem" }}
      >
        {player.pvp_battles}
      </td>

      {/* 胜率 */}
      <td className="font-mono" style={{ padding: "14px 16px", textAlign: "right", fontSize: "0.9rem" }}>
        <WinRate wins={player.pvp_wins} battles={player.pvp_battles} />
      </td>

      {/* 版本（窄屏隐藏） */}
      <td
        className="hidden sm:table-cell font-mono"
        style={{ padding: "14px 16px", textAlign: "right", color: "rgba(255,255,255,0.25)", fontSize: "0.8rem" }}
      >
        v{player.version}
      </td>
    </tr>
  )
}

// ── 主页面 ───────────────────────────────────────────────────
export default function SnakeLeaderboardPage() {
  const [players, setPlayers] = useState<SnakePlayerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchPlayers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/snake/players`)
      if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`)
      const data: SnakePlayerEntry[] = await res.json()
      // 按 ELO 降序排列
      data.sort((a, b) => (b.elo ?? 1500) - (a.elo ?? 1500))
      setPlayers(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0D0D1A]">
      {/* 点阵背景 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />
      {/* 渐变光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 w-[800px] h-[400px] opacity-[0.06]"
        style={{
          background: "radial-gradient(ellipse, #00F5D4 0%, #7B2FFF 50%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-10">

        {/* ── 顶部标题区 ──────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p
              className="font-mono text-[11px] font-black uppercase tracking-[0.5em] mb-2"
              style={{ color: "#00F5D4" }}
            >
              &gt; SNAKE_LEADERBOARD.SYS
            </p>
            <h1
              className="text-5xl font-black uppercase tracking-tighter text-white"
              style={{
                fontFamily: "var(--font-outfit)",
                textShadow: "3px 3px 0 #7B2FFF, 6px 6px 0 #00F5D4",
              }}
            >
              蛇王榜
            </h1>
            <p className="mt-2 font-mono text-xs text-white/35 uppercase tracking-widest">
              全服贪吃蛇竞技排名
            </p>
          </motion.div>

          {/* 刷新按钮 */}
          <button
            onClick={() => fetchPlayers(true)}
            disabled={loading || refreshing}
            className="-skew-x-3 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 disabled:opacity-30"
            style={{
              padding: "8px 20px",
              border: "2px solid rgba(0,245,212,0.5)",
              background: "rgba(0,245,212,0.06)",
              color: "#00F5D4",
              boxShadow: "0 0 10px rgba(0,245,212,0.1)",
            }}
            aria-label="刷新排行榜数据"
          >
            <span className="inline-flex items-center gap-2 skew-x-3">
              {refreshing ? <Loader2 className="size-3 animate-spin" /> : null}
              刷新
            </span>
          </button>
        </div>

        {/* ── 内容区 ─────────────────────────────────────────── */}
        {loading ? (
          // 加载状态
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="size-8 animate-spin" style={{ color: "#00F5D4" }} />
            <p className="font-mono text-xs uppercase tracking-widest text-white/30">
              LOADING_DATA.EXE
            </p>
          </div>
        ) : error ? (
          // 错误状态
          <div
            className="flex items-center gap-3 px-6 py-5"
            style={{ border: "2px dashed #FF6B35", background: "rgba(255,107,53,0.07)" }}
            role="alert"
          >
            <span className="font-mono text-xs font-black" style={{ color: "#FF6B35" }}>
              [ERR]
            </span>
            <span className="font-mono text-xs text-white/55">{error}</span>
            <button
              onClick={() => fetchPlayers()}
              className="-skew-x-3 ml-auto font-mono text-xs uppercase px-3 py-1"
              style={{ border: "1px solid #FF6B35", color: "#FF6B35", background: "rgba(255,107,53,0.08)" }}
            >
              <span className="inline-block skew-x-3">重试</span>
            </button>
          </div>
        ) : players.length === 0 ? (
          // 空数据状态
          <div
            className="flex flex-col items-center justify-center py-24 gap-3"
            style={{
              border: "2px dashed rgba(0,245,212,0.2)",
              background: "rgba(0,245,212,0.02)",
            }}
          >
            <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
              NO_DATA_FOUND
            </p>
          </div>
        ) : (
          // 排行表格
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="overflow-hidden"
            style={{
              border: "2px solid rgba(0,245,212,0.35)",
              borderTop: "2px solid #00F5D4",
              background: "rgba(0,0,0,0.6)",
              boxShadow: "0 0 20px rgba(0,245,212,0.1)",
            }}
          >
            {/* Chrome 标题栏 */}
            <div
              className="flex items-center gap-3 px-4 py-2 border-b-2"
              style={{ background: "rgba(0,245,212,0.06)", borderColor: "#00F5D4" }}
            >
              <span className="flex gap-1.5">
                {(["#00F5D4", "#FFE600", "#7B2FFF"] as const).map((c) => (
                  <span
                    key={c}
                    className="block size-2.5 rounded-full"
                    style={{ background: c, boxShadow: `0 0 5px ${c}` }}
                  />
                ))}
              </span>
              <span
                className="font-mono text-[11px] uppercase tracking-[0.3em]"
                style={{ color: "#00F5D4" }}
              >
                RANKING.DAT
              </span>
              <span className="ml-auto font-mono text-[10px] text-white/30">
                {players.length} ENTRIES
              </span>
            </div>

            {/* 表格 */}
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      background: "rgba(0,245,212,0.04)",
                      borderBottom: "1px solid rgba(0,245,212,0.15)",
                    }}
                  >
                    <Th>排名</Th>
                    <Th>蛇名</Th>
                    <Th className="hidden sm:table-cell">持有者</Th>
                    <Th align="right">ELO</Th>
                    <Th align="right">胜场</Th>
                    <Th align="right" className="hidden md:table-cell">场次</Th>
                    <Th align="right">胜率</Th>
                    <Th align="right" className="hidden sm:table-cell">版本</Th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player, idx) => (
                    <TableRow key={player.agent_id} player={player} rank={idx + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* ── 底部说明 ─────────────────────────────────────────── */}
        {!loading && !error && players.length > 0 && (
          <p
            className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.2)" }}
          >
            SORTED_BY: ELO DESC
          </p>
        )}
      </div>
    </main>
  )
}
