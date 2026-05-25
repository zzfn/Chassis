"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, Trophy } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import { getEloTier } from "@/lib/elo"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

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

function getEloTier(elo: number) {
  if (elo >= 1800) return { label: "钻石", color: "#818cf8" }
  if (elo >= 1500) return { label: "铂金", color: "#67e8f9" }
  if (elo >= 1300) return { label: "黄金", color: "#fbbf24" }
  if (elo >= 1100) return { label: "白银", color: "#a1a1aa" }
  return { label: "青铜", color: "#c2874f" }
}

function TankAvatar({ name }: { name: string }) {
  const initials = name.slice(0, 2).toUpperCase()
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-sm font-bold text-white"
      style={{ background: `hsl(${hue},40%,22%)` }}
    >
      {initials}
    </div>
  )
}

type SortKey = "elo" | "winRate" | "wins" | "battles"
type Period = "today" | "week" | "all"

export default function DashboardPage() {
  const router = useRouter()
  const [myUsername, setMyUsername] = useState("")
  const [players, setPlayers] = useState<PlayerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>("all")
  const [sortBy, setSortBy] = useState<SortKey>("elo")

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

  function challenge(agentId: string) {
    router.push(`/race?opponent=${agentId}`)
  }

  const sorted = [...players].sort((a, b) => {
    if (sortBy === "elo") return (b.elo ?? 1000) - (a.elo ?? 1000)
    if (sortBy === "wins") return b.pvp_wins - a.pvp_wins
    if (sortBy === "battles") return b.pvp_battles - a.pvp_battles
    const rA = a.pvp_battles > 0 ? a.pvp_wins / a.pvp_battles : 0
    const rB = b.pvp_battles > 0 ? b.pvp_wins / b.pvp_battles : 0
    return rB - rA || b.pvp_wins - a.pvp_wins
  })

  const PERIOD_LABELS: Record<Period, string> = { today: "今日", week: "本周", all: "历史总榜" }
  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: "elo", label: "Elo 分" },
    { value: "winRate", label: "胜率" },
    { value: "wins", label: "胜场数" },
    { value: "battles", label: "总场次" },
  ]

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 flex flex-col gap-6">

      {/* 标题 + 过滤器 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">排行榜</h1>
          <p className="mt-1 text-sm text-zinc-500">追踪今日晋升、本周黑马与历史总榜冠军。</p>
        </div>

        <div className="flex items-center gap-3">
          {/* 时间段 */}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="h-9 bg-zinc-900 ring-1 ring-zinc-700">
              <TabsTrigger
                value="today"
                className="px-3 text-xs font-semibold uppercase tracking-wide data-active:bg-zinc-100 data-active:text-zinc-900 dark:data-active:bg-zinc-100 dark:data-active:text-zinc-900"
              >
                今日
              </TabsTrigger>
              <TabsTrigger
                value="week"
                className="px-3 text-xs font-semibold uppercase tracking-wide data-active:bg-zinc-100 data-active:text-zinc-900 dark:data-active:bg-zinc-100 dark:data-active:text-zinc-900"
              >
                本周
              </TabsTrigger>
              <TabsTrigger
                value="all"
                className="gap-1 px-3 text-xs font-semibold uppercase tracking-wide data-active:bg-zinc-100 data-active:text-zinc-900 dark:data-active:bg-zinc-100 dark:data-active:text-zinc-900"
              >
                <Trophy className="size-3" />
                历史总榜
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* 排序 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 whitespace-nowrap">排序</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-400">{error}</p>}

      {/* 表格 */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        {/* 表头 */}
        <div className="grid grid-cols-[60px_1fr_90px_80px_80px_160px] border-b border-zinc-800 bg-zinc-900 px-4 py-3 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
          <span>排名</span>
          <span>坦克</span>
          <span className="text-right">Elo</span>
          <span className="text-right">胜场</span>
          <span className="text-right">胜率</span>
          <span className="text-right">操作</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" /> 加载中...
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500">
            暂无数据，去{" "}
            <Link href="/race" className="text-blue-400 hover:underline">竞技场</Link>
            {" "}提交你的第一个坦克
          </p>
        )}

        <div className="divide-y divide-zinc-800">
          {sorted.map((p, idx) => {
            const winRate = p.pvp_battles > 0 ? Math.round((p.pvp_wins / p.pvp_battles) * 100) : 0
            const elo = Math.round(p.elo ?? 1000)
            const tier = getEloTier(p.elo ?? 1000)
            const isMe = p.owner === myUsername
            const rankColor = idx === 0 ? "text-yellow-400" : idx === 1 ? "text-zinc-300" : idx === 2 ? "text-amber-600" : "text-zinc-600"

            return (
              <div
                key={p.agent_id}
                className={`grid grid-cols-[60px_1fr_90px_80px_80px_160px] items-center px-4 py-4 transition-colors hover:bg-zinc-900/60 ${isMe ? "bg-blue-950/10" : "bg-zinc-950"}`}
              >
                {/* 排名 */}
                <span className={`text-base font-black ${rankColor}`}>#{idx + 1}</span>

                {/* 坦克信息 */}
                <div className="flex items-center gap-3 min-w-0">
                  <TankAvatar name={p.agent_name} />
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate">{p.agent_name}</span>
                      {isMe && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-transparent bg-blue-600/20 text-blue-400"
                        >
                          我
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500 truncate">
                      {p.owner} · <span style={{ color: tier.color }}>{tier.label}</span> · {p.pvp_battles} 场
                    </span>
                  </div>
                </div>

                {/* Elo */}
                <span className="text-right text-base font-bold" style={{ color: tier.color }}>{elo}</span>

                {/* 胜场 */}
                <span className="text-right text-base font-bold text-white">{p.pvp_wins}</span>

                {/* 胜率 */}
                <span className="text-right text-sm font-medium text-zinc-400">{winRate}%</span>

                {/* 操作 */}
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/tanks/${p.agent_id}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "border-zinc-600 bg-transparent text-zinc-300 hover:border-zinc-400 hover:bg-transparent hover:text-white"
                    )}
                  >
                    详情
                  </Link>
                  {!isMe && (
                    <Button
                      onClick={() => challenge(p.agent_id)}
                      size="sm"
                      className="bg-blue-600 text-white hover:bg-blue-500"
                    >
                      挑战
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
