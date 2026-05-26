"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Play, Pause, SkipBack, SkipForward, ArrowLeft } from "lucide-react"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── 常量 ─────────────────────────────────────────────────────
const TILE = 30
const GRID = 20
const CANVAS_SIZE = TILE * GRID  // 600

const SNAKE_COLORS = ["#00F5D4", "#7B2FFF", "#FF8C00", "#FF3AF2"]
const FOOD_COLOR = "#FFE600"

const TILE_COLORS: Record<string, string> = {
  x: "#1a1a2e",
  m: "#3d2b1f",
  o: "#1a3320",
  ".": "#0d0d1a",
}

// 速度：ms/帧
const SPEED_OPTIONS: { label: string; ms: number }[] = [
  { label: "×0.5", ms: 240 },
  { label: "×1",   ms: 120 },
  { label: "×2",   ms:  60 },
  { label: "×5",   ms:  20 },
]

// ── 类型定义 ─────────────────────────────────────────────────
interface SnakeSnapshot {
  id: number
  name: string
  body: [number, number][]
  alive: boolean
  score: number
  direction: string
}

interface SnakeFrame {
  tick: number
  snakes: SnakeSnapshot[]
  food: [number, number][]
}

interface SnakeBattleRecord {
  id: string
  agent_name: string
  opponent: string
  winner: string
  total_ticks: number
  arena: { map: string[]; width: number; height: number }
  telemetry: SnakeFrame[]
  battle_log: string[]
  created_at: string
}

// ── Canvas 渲染函数 ───────────────────────────────────────────
function getEyeOffsets(direction: string): { ex1: number; ey1: number; ex2: number; ey2: number } {
  const e = 5
  const map: Record<string, { ex1: number; ey1: number; ex2: number; ey2: number }> = {
    east:  { ex1:  e, ey1: -e, ex2:  e, ey2:  e },
    west:  { ex1: -e, ey1: -e, ex2: -e, ey2:  e },
    north: { ex1: -e, ey1: -e, ex2:  e, ey2: -e },
    south: { ex1: -e, ey1:  e, ex2:  e, ey2:  e },
  }
  return map[direction] ?? map.east
}

function drawFrame(ctx: CanvasRenderingContext2D, mapStr: string[], frame: SnakeFrame) {
  // 地图背景
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const ch = mapStr[row]?.[col] ?? "."
      ctx.fillStyle = TILE_COLORS[ch] ?? TILE_COLORS["."]
      ctx.fillRect(col * TILE, row * TILE, TILE, TILE)
    }
  }

  // 网格线
  ctx.strokeStyle = "rgba(255,255,255,0.03)"
  ctx.lineWidth = 0.5
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath()
    ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, CANVAS_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * TILE); ctx.lineTo(CANVAS_SIZE, i * TILE)
    ctx.stroke()
  }

  // 食物（发光圆）
  for (const [fx, fy] of frame.food) {
    ctx.shadowColor = FOOD_COLOR
    ctx.shadowBlur = 8
    ctx.fillStyle = FOOD_COLOR
    ctx.beginPath()
    ctx.arc(fx * TILE + TILE / 2, fy * TILE + TILE / 2, TILE / 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // 蛇身
  for (const snake of frame.snakes) {
    if (!snake.alive || snake.body.length === 0) continue
    const color = SNAKE_COLORS[snake.id % SNAKE_COLORS.length]

    for (let i = snake.body.length - 1; i >= 0; i--) {
      const [x, y] = snake.body[i]
      const isHead = i === 0
      const alpha = isHead ? 1 : 0.7 - (i / snake.body.length) * 0.3

      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      const pad = isHead ? 2 : 4
      ctx.fillRect(x * TILE + pad, y * TILE + pad, TILE - pad * 2, TILE - pad * 2)
      ctx.globalAlpha = 1

      // 蛇头眼睛
      if (isHead) {
        ctx.fillStyle = "#fff"
        const eyeSize = 3
        const { ex1, ey1, ex2, ey2 } = getEyeOffsets(snake.direction)
        ctx.fillRect(x * TILE + TILE / 2 + ex1 - eyeSize / 2, y * TILE + TILE / 2 + ey1 - eyeSize / 2, eyeSize, eyeSize)
        ctx.fillRect(x * TILE + TILE / 2 + ex2 - eyeSize / 2, y * TILE + TILE / 2 + ey2 - eyeSize / 2, eyeSize, eyeSize)
      }
    }
  }
}

// ── Spinner ──────────────────────────────────────────────────
function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className="inline-block border-2 border-current border-t-transparent rounded-full"
      style={{
        width: size, height: size,
        animation: "spin 0.7s linear infinite",
      }}
    />
  )
}

// ── 主页面 ───────────────────────────────────────────────────
export default function SnakeReplayPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameIdxRef = useRef(0)
  const playingRef = useRef(false)
  const dataRef = useRef<SnakeBattleRecord | null>(null)

  // loading 初始为 true，fetch 完成后置 false，无需在 effect 内同步 setLoading(true)
  const [data, setData] = useState<SnakeBattleRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(120)

  // ref 同步
  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { dataRef.current = data }, [data])

  // 加载回放数据（不需要鉴权）
  useEffect(() => {
    if (!id) return
    fetch(`${apiBase}/api/snake/replay/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SnakeBattleRecord>
      })
      .then(d => {
        setData(d)
        setFrameIdx(0)
        setTimeout(() => setPlaying(true), 300)
      })
      .catch(e => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false))
  }, [id])

  // Canvas 渲染
  const render = useCallback((idx: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const d = dataRef.current
    if (!d || !d.telemetry[idx]) return
    drawFrame(ctx, d.arena.map, d.telemetry[idx])
  }, [])

  useEffect(() => { render(frameIdx) }, [frameIdx, render, data])

  // 动画循环
  useEffect(() => {
    if (animRef.current) clearTimeout(animRef.current)
    if (!playing || !data) return

    const step = () => {
      const next = frameIdxRef.current + 1
      const total = dataRef.current?.telemetry.length ?? 0
      if (next >= total) {
        setPlaying(false)
        return
      }
      setFrameIdx(next)
      animRef.current = setTimeout(step, speed)
    }
    animRef.current = setTimeout(step, speed)
    return () => { if (animRef.current) clearTimeout(animRef.current) }
  }, [playing, speed, data])

  const totalFrames = data?.telemetry.length ?? 0
  const currentFrame = data?.telemetry[frameIdx]

  // ── 错误状态 ────────────────────────────────────────────
  if (error) {
    return (
      <main className="min-h-screen bg-[#0D0D1A] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg font-bold mb-2">加载失败</p>
          <p className="text-white/40 text-sm mb-6">{error}</p>
          <button
            onClick={() => router.back()}
            className="border border-[#7B2FFF] text-[#7B2FFF] font-bold px-5 py-2 rounded-lg hover:bg-[#7B2FFF]/10 transition-all"
          >
            返回
          </button>
        </div>
      </main>
    )
  }

  // ── 加载状态 ────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-[#0D0D1A] flex items-center justify-center">
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div className="flex flex-col items-center gap-4 text-[#00F5D4]">
          <Spinner size={36} />
          <p className="text-sm font-bold tracking-widest uppercase">载入回放…</p>
        </div>
      </main>
    )
  }

  if (!data) return null

  return (
    <main className="min-h-screen bg-[#0D0D1A] text-white px-4 py-8">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div className="max-w-5xl mx-auto flex flex-col gap-6">

        {/* 顶部导航 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 border border-dashed border-[#7B2FFF] text-[#7B2FFF] font-bold text-sm px-4 py-1.5 rounded-full hover:bg-[#7B2FFF]/10 transition-all"
          >
            <ArrowLeft size={14} /> 返回
          </button>
          <div
            className="flex items-center gap-2 rounded-full border px-4 py-1.5"
            style={{ borderColor: "#00F5D4", background: "rgba(0,245,212,0.08)" }}
          >
            <span className="w-2 h-2 rounded-full bg-[#00F5D4] animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-[#00F5D4]">Snake Replay</span>
          </div>
        </div>

        {/* 对战信息卡 */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "2px solid rgba(0,245,212,0.3)", background: "rgba(255,255,255,0.04)" }}
        >
          <div className="flex items-stretch">
            {/* 挑战者 */}
            <div className="flex flex-1 items-center gap-3 px-6 py-4">
              <div
                className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-black"
                style={{ background: "rgba(0,245,212,0.15)", border: "2px solid #00F5D4", color: "#00F5D4" }}
              >
                {data.agent_name[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <p className="font-black text-white">{data.agent_name}</p>
                {data.winner === data.agent_name && (
                  <span className="text-[10px] text-[#FFE600] font-bold">WINNER</span>
                )}
              </div>
            </div>

            {/* VS 中间区 */}
            <div
              className="flex flex-col items-center justify-center px-6 py-4 gap-1"
              style={{ borderLeft: "2px dashed rgba(255,58,242,0.25)", borderRight: "2px dashed rgba(255,58,242,0.25)" }}
            >
              <span className="text-lg font-black text-[#FF3AF2]">VS</span>
              <span className="text-xs text-white/30 font-mono">{data.total_ticks} ticks</span>
              <span className="text-xs text-white/20">{new Date(data.created_at).toLocaleDateString()}</span>
            </div>

            {/* 对手 */}
            <div className="flex flex-1 items-center justify-end gap-3 px-6 py-4">
              <div className="text-right">
                <p className="font-black text-white">{data.opponent}</p>
                {data.winner === data.opponent && (
                  <span className="text-[10px] text-[#FFE600] font-bold">WINNER</span>
                )}
              </div>
              <div
                className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-black"
                style={{ background: "rgba(123,47,255,0.15)", border: "2px solid #7B2FFF", color: "#7B2FFF" }}
              >
                {data.opponent[0]?.toUpperCase() ?? "?"}
              </div>
            </div>
          </div>

          {/* 胜者横幅 */}
          {data.winner && (
            <div
              className="px-6 py-2 text-center text-sm font-bold"
              style={{
                borderTop: "2px dashed rgba(255,230,0,0.3)",
                background: "rgba(255,230,0,0.06)",
                color: "#FFE600",
              }}
            >
              胜者：{data.winner} &nbsp;&nbsp;|&nbsp;&nbsp; 总回合：{data.total_ticks}
            </div>
          )}
        </div>

        {/* 主内容区：Canvas + 右侧面板 */}
        <div className="flex gap-6 items-start flex-wrap lg:flex-nowrap">

          {/* Canvas 区域 */}
          <div className="flex flex-col gap-3">

            {/* 播放控制栏 */}
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {/* 跳到首帧 */}
              <button
                onClick={() => { setPlaying(false); setFrameIdx(0) }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
                title="跳到开头"
              >
                <SkipBack size={14} />
              </button>

              {/* 播放/暂停 */}
              <button
                onClick={() => {
                  if (frameIdx >= totalFrames - 1) {
                    setFrameIdx(0)
                    setTimeout(() => setPlaying(true), 50)
                  } else {
                    setPlaying(p => !p)
                  }
                }}
                className="p-2 rounded-xl text-white transition"
                style={{ background: "linear-gradient(135deg,#00F5D4,#7B2FFF)", boxShadow: "0 0 10px rgba(0,245,212,0.35)" }}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>

              {/* 跳到末帧 */}
              <button
                onClick={() => { setPlaying(false); setFrameIdx(totalFrames - 1) }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
                title="跳到结尾"
              >
                <SkipForward size={14} />
              </button>

              {/* 进度条 */}
              <input
                type="range"
                min={0}
                max={Math.max(0, totalFrames - 1)}
                value={frameIdx}
                onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)) }}
                className="flex-1 accent-[#00F5D4]"
              />

              {/* 帧计数 */}
              <span className="font-mono text-xs text-[#00F5D4] tabular-nums w-20 text-right shrink-0">
                {frameIdx + 1} / {totalFrames}
              </span>
            </div>

            {/* Canvas */}
            <div
              className="relative rounded-xl overflow-hidden"
              style={{
                width: CANVAS_SIZE,
                height: CANVAS_SIZE,
                border: "2px solid rgba(0,245,212,0.25)",
                boxShadow: "0 0 30px rgba(0,245,212,0.08)",
              }}
            >
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className="block"
              />
            </div>

            {/* 速度控制 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/30 mr-1">速度</span>
              {SPEED_OPTIONS.map(opt => (
                <button
                  key={opt.ms}
                  onClick={() => setSpeed(opt.ms)}
                  className="text-xs px-2.5 py-1 rounded-lg transition"
                  style={{
                    background: speed === opt.ms ? "#7B2FFF" : "rgba(255,255,255,0.05)",
                    color: speed === opt.ms ? "#fff" : "rgba(255,255,255,0.4)",
                    border: speed === opt.ms ? "1px solid #7B2FFF" : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 右侧面板 */}
          <div className="flex-1 flex flex-col gap-4 min-w-0 lg:min-w-[220px]">

            {/* 蛇图例 */}
            <div
              className="rounded-xl p-4"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-xs font-black uppercase tracking-widest text-white/40 mb-3">参赛蛇</p>
              <div className="flex flex-col gap-3">
                {(currentFrame?.snakes ?? data.telemetry[0]?.snakes ?? []).map(s => {
                  const color = SNAKE_COLORS[s.id % SNAKE_COLORS.length]
                  return (
                    <div key={s.id} className="flex items-center gap-2.5">
                      <div
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                      />
                      <span className="text-sm font-bold text-white flex-1 min-w-0 truncate">{s.name}</span>
                      <span className="font-mono text-xs text-[#FFE600] shrink-0">×{s.score}</span>
                      {!s.alive && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                        >
                          死亡
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 战斗日志 */}
            <div
              className="rounded-xl flex flex-col overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                maxHeight: "420px",
              }}
            >
              <div
                className="px-4 py-2.5 shrink-0"
                style={{ borderBottom: "1px dashed rgba(255,255,255,0.08)" }}
              >
                <p className="text-xs font-black uppercase tracking-widest text-white/40">战斗日志</p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5">
                {data.battle_log.length === 0 ? (
                  <p className="text-white/20 text-xs">无日志</p>
                ) : (
                  data.battle_log.map((line, i) => (
                    <p key={i} className="text-xs text-white/50 leading-5 font-mono break-all">
                      {line}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
