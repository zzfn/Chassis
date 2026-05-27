"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Link from "next/link"
import { Loader2, Swords, ChevronRight } from "lucide-react"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"
const PAGE_SIZE = 30

interface BattleEntry {
  id: string
  challenger: string
  challenger_owner: string | null
  challenger_svg: string | null
  opponent: string
  opponent_owner: string | null
  opponent_svg: string | null
  winner: string
  total_ticks: number
  created_at: string
}


function TankAvatar({ name, svg, size = 40 }: { name: string; svg?: string | null; size?: number }) {
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full border-2 font-black text-white flex items-center justify-center"
      style={{
        width:       size,
        height:      size,
        fontSize:    size * 0.28,
        background:  `hsl(${hue}, 40%, ${svg ? 10 : 18}%)`,
        borderColor: `hsl(${hue}, 70%, 60%)`,
        boxShadow:   `0 0 10px hsl(${hue}, 70%, 60%, 0.35)`,
      }}
    >
      {svg ? (
        <svg viewBox="-20 -14 40 28" width={size * 0.8} height={size * 0.55}
          dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </div>
  )
}

function BattleRow({ b }: { b: BattleEntry }) {
  const cWon = b.winner === b.challenger
  const oWon = b.winner === b.opponent

  return (
    <Link
      href={`/replay/${b.id}`}
      className="group flex items-center gap-3 rounded-2xl border-2 border-transparent px-4 py-3 transition-all duration-150 hover:border-[#FF3AF2]/40 hover:bg-[#FF3AF2]/5"
    >
      {/* 挑战方 */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <TankAvatar name={b.challenger} svg={b.challenger_svg} />
        <div className="min-w-0">
          <p className={`truncate text-sm font-black ${cWon ? "text-[#FFE600]" : "text-white/80"}`}>
            {b.challenger}
            {cWon && <span className="ml-1.5 text-xs">👑</span>}
          </p>
          {b.challenger_owner && (
            <p className="truncate text-xs text-white/35">{b.challenger_owner}</p>
          )}
        </div>
      </div>

      {/* VS 中间 */}
      <div className="flex shrink-0 flex-col items-center gap-0.5 px-2">
        <Swords className="size-4 text-[#FF3AF2]/70" />
        <span className="text-[10px] font-black tracking-widest text-white/30">
          {b.total_ticks}帧
        </span>
      </div>

      {/* 对手方 */}
      <div className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2.5">
        <TankAvatar name={b.opponent} svg={b.opponent_svg} />
        <div className="min-w-0 text-right">
          <p className={`truncate text-sm font-black ${oWon ? "text-[#FFE600]" : "text-white/80"}`}>
            {oWon && <span className="mr-1.5 text-xs">👑</span>}
            {b.opponent}
          </p>
          {b.opponent_owner && (
            <p className="truncate text-xs text-white/35">{b.opponent_owner}</p>
          )}
        </div>
      </div>

      <ChevronRight className="size-4 shrink-0 text-white/20 transition-colors group-hover:text-[#FF3AF2]/60" />
    </Link>
  )
}

export default function MatchesPage() {
  const [battles, setBattles] = useState<BattleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const offsetRef = useRef(0)

  const load = useCallback(async (offset: number) => {
    try {
      const res = await fetch(`${apiBase}/api/battles/recent?limit=${PAGE_SIZE}&offset=${offset}`)
      if (!res.ok) throw new Error("加载失败")
      const data: BattleEntry[] = await res.json()
      setBattles(prev => offset === 0 ? data : [...prev, ...data])
      setHasMore(data.length === PAGE_SIZE)
      offsetRef.current = offset + data.length
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    }
  }, [])

  useEffect(() => {
    load(0).finally(() => setLoading(false))
  }, [load])

  async function loadMore() {
    setLoadingMore(true)
    await load(offsetRef.current)
    setLoadingMore(false)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0D0D1A]">
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.06]" />

      <div className="relative mx-auto max-w-3xl px-4 py-10">
        {/* 标题 */}
        <div className="mb-8 flex items-center gap-3">
          <div
            className="flex size-12 items-center justify-center rounded-2xl border-4 border-[#FF3AF2]"
            style={{ background: "rgba(255,58,242,0.12)", boxShadow: "0 0 20px rgba(255,58,242,0.3)" }}
          >
            <Swords className="size-6 text-[#FF3AF2]" />
          </div>
          <div>
            <h1
              className="text-2xl font-black uppercase tracking-tight text-white"
              style={{ textShadow: "2px 2px 0 #FF3AF2" }}
            >
              公开对战
            </h1>
            <p className="text-xs font-bold text-white/40">最近的竞技场对战记录</p>
          </div>
        </div>

        {/* 内容 */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="size-8 animate-spin text-[#FF3AF2]" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border-4 border-dashed border-[#FF6B35] bg-[#FF6B35]/10 px-6 py-8 text-center">
            <p className="font-black text-[#FF6B35]">{error}</p>
          </div>
        ) : battles.length === 0 ? (
          <div className="rounded-2xl border-4 border-dashed border-white/20 px-6 py-16 text-center">
            <p className="text-4xl">⚔️</p>
            <p className="mt-3 font-black text-white/40">还没有任何对战记录</p>
          </div>
        ) : (
          <>
            <div
              className="overflow-hidden rounded-3xl"
              style={{
                background: "rgba(255,255,255,0.03)",
                border:     "3px solid rgba(255,58,242,0.2)",
                boxShadow:  "0 0 40px rgba(255,58,242,0.08)",
              }}
            >
              <div className="divide-y divide-white/[0.06]">
                {battles.map(b => (
                  <BattleRow key={b.id} b={b} />
                ))}
              </div>
            </div>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-full border-4 border-dashed border-[#7B2FFF] px-6 py-2 text-sm font-black uppercase tracking-widest text-[#7B2FFF] transition-all duration-150 hover:bg-[#7B2FFF]/10 hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "加载更多"
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
