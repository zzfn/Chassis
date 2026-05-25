"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, Search, Shuffle } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

interface MyTank { agent_id: string; agent_name: string }
interface Player { agent_id: string; agent_name: string; owner: string; pvp_wins: number; pvp_battles: number }

// 地图定义（ASCII 预览 + 元数据）
const MAPS = [
  {
    id: "classic",
    name: "经典战场",
    subtitle: "标准地图",
    battles: "80万+",
    preview: [
      "xxxxxxxxxxxx",
      "x..........x",
      "x.xx....xx.x",
      "x..........x",
      "x...oo..oo.x",
      "x..........x",
      "xxx........x",
      "x...mm.....x",
      "x....mm.mm.x",
      "x..........x",
      "x.xx....xx.x",
      "xxxxxxxxxxxx",
    ],
  },
]

const TILE_COLORS: Record<string, string> = {
  x: "#3f3f46",
  m: "#7c3414",
  o: "#14532d",
  ".": "#18181b",
}

function MapPreview({ rows }: { rows: string[]; selected: boolean }) {
  const tileSize = 6
  return (
    <div
      className={`inline-grid gap-0 rounded`}
      style={{ display: "grid", gridTemplateColumns: `repeat(${rows[0]?.length ?? 12}, ${tileSize}px)` }}
    >
      {rows.map((row, ri) =>
        row.split("").map((ch, ci) => (
          <div
            key={`${ri}-${ci}`}
            style={{
              width: tileSize,
              height: tileSize,
              backgroundColor: TILE_COLORS[ch] ?? "#18181b",
            }}
          />
        ))
      )}
    </div>
  )
}

function getRankTier(wins: number, battles: number) {
  if (battles === 0) return "新兵"
  const r = wins / battles
  if (r >= 0.75) return "铂金"
  if (r >= 0.60) return "黄金"
  if (r >= 0.45) return "白银"
  return "青铜"
}

const panelClass = "border border-zinc-800 bg-zinc-900 ring-0 p-5 gap-3 rounded-xl"
const summaryCardClass = "border border-zinc-800 bg-zinc-900 ring-0 p-4 gap-2 rounded-xl"

function RaceContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [myTanks, setMyTanks] = useState<MyTank[]>([])
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [search, setSearch] = useState("")
  const [selectedOpponent, setSelectedOpponent] = useState<Player | null>(null)
  const [selectedMap, setSelectedMap] = useState(MAPS[0])
  const [battling, setBattling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = getCookie("token")
    if (!token) return
    fetch(`${apiBase}/api/my-tanks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((tanks: MyTank[]) => {
        setMyTanks(tanks)
        const paramTank = searchParams.get("tank")
        const initial = tanks.find(t => t.agent_id === paramTank) ?? tanks[0] ?? null
        if (initial) setSelectedTankId(initial.agent_id)
      })
      .catch(() => {})

    fetch(`${apiBase}/api/players`)
      .then(r => r.json())
      .then(setPlayers)
      .catch(() => {})
  }, [searchParams])

  const myTank = myTanks.find(t => t.agent_id === selectedTankId) ?? null

  const filteredPlayers = players.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return p.agent_name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q)
  })

  function pickRandom() {
    const others = players.filter(p => p.agent_id !== selectedTankId)
    if (others.length === 0) return
    setSelectedOpponent(others[Math.floor(Math.random() * others.length)])
  }

  async function startBattle() {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    if (!selectedTankId) { setError("请先选择你的坦克"); return }
    if (!selectedOpponent) { setError("请选择对手"); return }
    setBattling(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/challenge/${selectedOpponent.agent_id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "对战失败")
      router.push(`/replay/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "对战失败")
      setBattling(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 flex flex-col gap-4">

      {/* ── 我的坦克 ── */}
      <Card className={panelClass}>
        <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">我的坦克</p>
        {myTanks.length === 0 ? (
          <p className="text-sm text-zinc-600">
            还没有坦克，先去{" "}
            <Button
              variant="link"
              size="sm"
              onClick={() => router.push("/tanks")}
              className="h-auto px-0 text-blue-400"
            >
              我的坦克
            </Button>
            {" "}创建一个
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {myTanks.map(t => {
              const active = selectedTankId === t.agent_id
              return (
                <Button
                  key={t.agent_id}
                  onClick={() => setSelectedTankId(t.agent_id)}
                  variant={active ? "default" : "outline"}
                  className={cn(
                    "h-9 px-4 text-sm font-semibold",
                    active
                      ? "bg-blue-600 text-white hover:bg-blue-500"
                      : "border-zinc-700 bg-transparent text-zinc-300 hover:border-zinc-500 hover:bg-transparent hover:text-white"
                  )}
                >
                  {t.agent_name}
                </Button>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── 搜索对手 ── */}
      <Card className={panelClass}>
        <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">选择对手</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
            <Input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索坦克名称或用户名…"
              className="h-10 w-full rounded-lg border-zinc-700 bg-zinc-800 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:border-blue-500 focus-visible:ring-blue-500/40"
            />
          </div>
          <Button
            variant="outline"
            onClick={pickRandom}
            title="随机选择"
            className="h-10 gap-1.5 rounded-lg border-zinc-700 bg-transparent px-4 text-sm text-zinc-300 hover:border-zinc-500 hover:bg-transparent hover:text-white"
          >
            <Shuffle className="size-4" /> 随机
          </Button>
        </div>

        {/* 对手列表 */}
        {filteredPlayers.length > 0 && (
          <div className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 max-h-48 overflow-y-auto">
            {filteredPlayers.map(p => (
              <button
                key={p.agent_id}
                onClick={() => setSelectedOpponent(p.agent_id === selectedTankId ? null : p)}
                className={`flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800 ${
                  selectedOpponent?.agent_id === p.agent_id ? "bg-blue-950/40" : ""
                }`}
              >
                <div
                  className={`size-2 rounded-full shrink-0 ${selectedOpponent?.agent_id === p.agent_id ? "bg-blue-400" : "bg-zinc-700"}`}
                />
                <span className="flex-1 text-sm font-medium text-zinc-200">{p.agent_name}</span>
                <span className="text-xs text-zinc-500">{p.owner}</span>
                <span className="text-xs text-zinc-600">
                  {p.pvp_battles > 0 ? `${Math.round(p.pvp_wins / p.pvp_battles * 100)}%` : "-"}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ── 对战摘要 ── */}
      <section className="grid grid-cols-3 gap-3">
        <Card className={summaryCardClass}>
          <p className="text-xs text-zinc-500">我的坦克</p>
          <p className="text-lg font-bold text-white truncate">{myTank?.agent_name ?? "未选择"}</p>
          {myTank && (
            <p className="text-xs text-zinc-600">
              {(() => {
                const p = players.find(p => p.agent_id === selectedTankId)
                return p ? getRankTier(p.pvp_wins, p.pvp_battles) : "新兵"
              })()}
            </p>
          )}
        </Card>
        <Card className={cn(summaryCardClass, "gap-3")}>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-zinc-500">目标坦克</p>
            <p className={`text-lg font-bold ${selectedOpponent ? "text-white" : "text-zinc-600"}`}>
              {selectedOpponent?.agent_name ?? "未选择"}
            </p>
          </div>
          <Button
            onClick={startBattle}
            disabled={battling || !selectedOpponent || !myTank}
            className="h-9 w-full bg-blue-600 text-sm font-bold text-white hover:bg-blue-500"
          >
            {battling ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" />对战中…
              </span>
            ) : "开始对战"}
          </Button>
        </Card>
        <Card className={summaryCardClass}>
          <p className="text-xs text-zinc-500">地图</p>
          <p className="text-lg font-bold text-white">{selectedMap.name}</p>
          <p className="text-xs text-zinc-600">{selectedMap.subtitle}</p>
        </Card>
      </section>

      {error && <p className="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400">{error}</p>}

    </main>
  )
}

export default function ArenaPage() {
  return (
    <Suspense>
      <RaceContent />
    </Suspense>
  )
}
