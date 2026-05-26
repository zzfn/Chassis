"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Play, Pause, SkipBack, SkipForward, Loader2, Zap } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { getCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── Canvas 常量 ───────────────────────────────────────────────
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
interface UserSnakeEntry {
  agent_id: string
  agent_name: string
  pvp_battles: number
  pvp_wins: number
  version: number
}

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
  timed_out?: boolean
  arena: { map: string[]; width: number; height: number }
  telemetry: SnakeFrame[]
  battle_log: string[]
}

interface BattleResult {
  id: string
  winner: string
  winner_label: string
  total_ticks: number
  replay_url: string
}

interface LogEntry {
  id: number
  text: string
  ts: string
}

// ── Canvas 渲染辅助 ───────────────────────────────────────────
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
  // 1. 填充 tile 背景色
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const ch = mapStr[row]?.[col] ?? "."
      ctx.fillStyle = TILE_COLORS[ch] ?? TILE_COLORS["."]
      ctx.fillRect(col * TILE, row * TILE, TILE, TILE)
    }
  }

  // 2. 网格线
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

  // 3. 食物（发光圆）
  for (const [fx, fy] of frame.food) {
    ctx.shadowColor = FOOD_COLOR
    ctx.shadowBlur = 8
    ctx.fillStyle = FOOD_COLOR
    ctx.beginPath()
    ctx.arc(fx * TILE + TILE / 2, fy * TILE + TILE / 2, TILE / 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // 4. 蛇身
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

      // 头部眼睛
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

// ── 主页面 ───────────────────────────────────────────────────
export default function SnakeArenaPage() {
  const router = useRouter()

  // ── 登录检查 ─────────────────────────────────────────────
  const [isLoggedIn] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null
    return !!getCookie("token")
  })

  // ── 左栏状态 ─────────────────────────────────────────────
  const [snakes, setSnakes] = useState<UserSnakeEntry[]>([])
  const [ctxLoading, setCtxLoading] = useState(false)
  const [selectedName, setSelectedName] = useState<string>("")
  const [battling, setBattling] = useState(false)
  const [battleError, setBattleError] = useState<string | null>(null)
  const [battleResult, setBattleResult] = useState<BattleResult | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logCounterRef = useRef(0)

  // ── 右栏 Canvas 回放状态 ─────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameIdxRef = useRef(0)
  const playingRef = useRef(false)
  const replayDataRef = useRef<SnakeBattleRecord | null>(null)

  const [replayData, setReplayData] = useState<SnakeBattleRecord | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(120)
  const [replayLoading, setReplayLoading] = useState(false)

  // ref 同步
  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { replayDataRef.current = replayData }, [replayData])

  // ── 加载 context ─────────────────────────────────────────
  useEffect(() => {
    const token = getCookie("token")
    if (!token) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCtxLoading(true)
    fetch(`${apiBase}/api/snake/context`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { snakes: UserSnakeEntry[]; current_name: string | null }) => {
        setSnakes(data.snakes ?? [])
        if (data.current_name) {
          setSelectedName(data.current_name)
        } else if (data.snakes?.length > 0) {
          setSelectedName(data.snakes[0].agent_name)
        }
      })
      .catch(() => {})
      .finally(() => setCtxLoading(false))
  }, [])

  // ── 添加日志条目（最多 20 条）────────────────────────────
  function addLog(text: string) {
    const id = ++logCounterRef.current
    const ts = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLogs(prev => [{ id, text, ts }, ...prev].slice(0, 20))
  }

  // ── Canvas 渲染 ───────────────────────────────────────────
  const render = useCallback((idx: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const d = replayDataRef.current
    if (!d || !d.telemetry[idx]) return
    drawFrame(ctx, d.arena.map, d.telemetry[idx])
  }, [])

  useEffect(() => { render(frameIdx) }, [frameIdx, render, replayData])

  // ── 动画循环 ─────────────────────────────────────────────
  useEffect(() => {
    if (animRef.current) clearTimeout(animRef.current)
    if (!playing || !replayData) return

    const step = () => {
      const next = frameIdxRef.current + 1
      const total = replayDataRef.current?.telemetry.length ?? 0
      if (next >= total) {
        setPlaying(false)
        return
      }
      setFrameIdx(next)
      animRef.current = setTimeout(step, speed)
    }
    animRef.current = setTimeout(step, speed)
    return () => { if (animRef.current) clearTimeout(animRef.current) }
  }, [playing, speed, replayData])

  // ── 开战流程 ─────────────────────────────────────────────
  async function handleBattle() {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    if (!selectedName) { setBattleError("请先选择蛇"); return }

    setBattling(true)
    setBattleError(null)
    setBattleResult(null)

    addLog(`发起对战：${selectedName} vs 随机对手…`)

    try {
      // Step 1: POST simulate
      const simRes = await fetch(`${apiBase}/api/snake/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: selectedName, random_opponent: true }),
      })
      const simData = await simRes.json() as {
        id?: string
        winner?: string
        winner_label?: string
        total_ticks?: number
        replay_url?: string
        error?: string
      }
      if (!simRes.ok) throw new Error(simData.error ?? "仿真失败")
      if (!simData.id) throw new Error("未返回对战 ID")

      const result: BattleResult = {
        id: simData.id,
        winner: simData.winner ?? "",
        winner_label: simData.winner_label ?? simData.winner ?? "",
        total_ticks: simData.total_ticks ?? 0,
        replay_url: simData.replay_url ?? `/snake/replay/${simData.id}`,
      }
      setBattleResult(result)

      const isWin = result.winner === selectedName
      addLog(`对战完成！${isWin ? "获胜" : "落败"} · 共 ${result.total_ticks} 回合`)

      // Step 2: GET replay
      setReplayLoading(true)
      const replayRes = await fetch(`${apiBase}/api/snake/replay/${simData.id}`)
      const record = await replayRes.json() as SnakeBattleRecord
      if (!replayRes.ok) throw new Error("回放加载失败")

      setReplayData(record)
      setFrameIdx(0)
      setPlaying(false)

      // 延迟自动播放
      setTimeout(() => setPlaying(true), 400)

      addLog(`回放就绪，共 ${record.telemetry.length} 帧`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误"
      setBattleError(msg)
      addLog(`错误：${msg}`)
    } finally {
      setBattling(false)
      setReplayLoading(false)
    }
  }

  const totalFrames = replayData?.telemetry.length ?? 0
  const currentFrame = replayData?.telemetry[frameIdx]

  // ── 未登录（加载中） ──────────────────────────────────────
  if (isLoggedIn === null) {
    return (
      <main className="min-h-screen bg-[#0D0D1A] flex items-center justify-center">
        <Loader2 className="size-7 animate-spin" style={{ color: "#00F5D4" }} />
      </main>
    )
  }

  // ── 未登录 ───────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <main className="relative min-h-screen bg-[#0D0D1A] flex items-center justify-center px-4 overflow-hidden">
        {/* 背景层 */}
        <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 size-[600px] opacity-[0.07]"
          style={{
            background: "radial-gradient(circle, #00F5D4 0%, #7B2FFF 45%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative z-10 text-center flex flex-col items-center gap-6"
        >
          <div>
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.5em] mb-2" style={{ color: "#00F5D4" }}>
              &gt; ACCESS_DENIED.SYS
            </p>
            <h2 className="text-3xl font-black uppercase tracking-tighter text-white"
              style={{ textShadow: "3px 3px 0 #7B2FFF, 6px 6px 0 #00F5D4" }}>
              需要登录
            </h2>
            <p className="mt-2 font-mono text-xs text-white/30 uppercase tracking-widest">
              请先登录以使用蛇竞技场
            </p>
          </div>

          <motion.a
            href="/login"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="-skew-x-3 px-8 py-3 font-mono font-black uppercase tracking-[0.3em] text-sm transition-all"
            style={{
              border: "2px solid #00F5D4",
              background: "linear-gradient(135deg, #00F5D4 0%, #7B2FFF 50%, #00F5D4 100%)",
              color: "#FFE600",
              boxShadow: "0 0 24px rgba(0,245,212,0.4)",
            }}
          >
            <span className="inline-block skew-x-3">前往登录</span>
          </motion.a>
        </motion.div>
      </main>
    )
  }

  const isWinner = battleResult?.winner === selectedName
  const ready = !battling && snakes.length > 0 && !!selectedName

  return (
    <main className="relative min-h-screen bg-[#0D0D1A] text-white px-4 py-8 overflow-hidden">

      {/* ── 背景层 ── */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-56 opacity-[0.12]"
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
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 size-[600px] opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, #00F5D4 0%, #7B2FFF 45%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto">

        {/* ── 顶部标题行 ── */}
        <div className="flex items-center justify-between mb-8">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.5em] mb-1" style={{ color: "#00F5D4" }}>
              &gt; SNAKE_ARENA.SYS
            </p>
            <h1
              className="text-5xl font-black uppercase tracking-tighter text-white"
              style={{ fontFamily: "var(--font-outfit)", textShadow: "3px 3px 0 #7B2FFF, 6px 6px 0 #00F5D4" }}
            >
              蛇竞技场
            </h1>
            <p className="text-white/35 text-sm mt-1 font-mono">选好蛇，点开战，立即对抗随机对手</p>
          </motion.div>

          <motion.button
            onClick={() => router.back()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="font-mono text-xs uppercase tracking-[0.3em] px-4 py-1.5 transition-all"
            style={{
              border: "1px dashed rgba(0,245,212,0.25)",
              color: "rgba(255,255,255,0.35)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#00F5D4"
              ;(e.currentTarget as HTMLButtonElement).style.color = "#00F5D4"
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,245,212,0.25)"
              ;(e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)"
            }}
          >
            &lt;- 返回
          </motion.button>
        </div>

        {/* ── 主体两栏 ── */}
        <div className="flex gap-6 items-start flex-wrap xl:flex-nowrap">

          {/* ── 左栏：操作面板 ── */}
          <div className="w-full xl:w-[340px] shrink-0 flex flex-col gap-4">

            {/* 蛇选择面板（Chrome panel） */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 }}
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
                  {(["#00F5D4", "#FFE600", "#7B2FFF"] as const).map(c => (
                    <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                  ))}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#00F5D4" }}>
                  SELECT_SNAKE.DAT
                </span>
              </div>

              <div className="p-5 flex flex-col gap-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 mb-3 block">
                    出战蛇
                  </label>

                  {ctxLoading ? (
                    <div className="flex items-center gap-2 text-white/30">
                      <Loader2 className="size-3.5 animate-spin" style={{ color: "#00F5D4" }} />
                      <span className="font-mono text-xs uppercase tracking-wider">LOADING...</span>
                    </div>
                  ) : snakes.length === 0 ? (
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-white/30 uppercase tracking-wider">无可用蛇 —</span>
                      <a
                        href="/snake"
                        className="font-mono text-xs uppercase tracking-wider underline"
                        style={{ color: "#00F5D4" }}
                      >
                        去提交代码
                      </a>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2.5">
                      {snakes.map(s => {
                        const active = selectedName === s.agent_name
                        return (
                          <motion.button
                            key={s.agent_id}
                            onClick={() => { setSelectedName(s.agent_name); setBattleError(null) }}
                            whileTap={{ scale: 0.95 }}
                            className="-skew-x-6 px-5 py-2 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 hover:skew-x-0"
                            style={{
                              border: `2px ${active ? "solid" : "dashed"} ${active ? "#00F5D4" : "rgba(0,245,212,0.3)"}`,
                              background: active ? "rgba(0,245,212,0.15)" : "transparent",
                              color: active ? "#00F5D4" : "rgba(255,255,255,0.4)",
                              boxShadow: active ? "0 0 14px rgba(0,245,212,0.35)" : "none",
                            }}
                          >
                            <span className="inline-block skew-x-6">{s.agent_name}</span>
                          </motion.button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 对手类型（只读标签） */}
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 mb-2 block">
                    对手模式
                  </label>
                  <div
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                    style={{
                      background: "rgba(123,47,255,0.08)",
                      border: "1px solid rgba(123,47,255,0.3)",
                      color: "#7B2FFF",
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7B2FFF] shrink-0" />
                    <span className="font-mono text-xs">随机对手</span>
                    <span className="ml-auto text-[10px] text-white/20 font-mono">RANDOM</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* 开战按钮 */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.14 }}
            >
              <motion.button
                onClick={handleBattle}
                disabled={battling || snakes.length === 0 || !selectedName}
                whileHover={ready ? { scale: 1.02 } : {}}
                whileTap={ready ? { scale: 0.97 } : {}}
                className="relative w-full -skew-x-3 overflow-hidden font-mono font-black uppercase transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-25"
                style={{
                  height: 64,
                  border: "2px solid #FFE600",
                  background: ready
                    ? "linear-gradient(135deg, #00F5D4 0%, #7B2FFF 50%, #00F5D4 100%)"
                    : "rgba(0,245,212,0.05)",
                  color: "#FFE600",
                  letterSpacing: "0.35em",
                  fontSize: 15,
                  boxShadow: ready
                    ? "0 0 30px rgba(0,245,212,0.45), 0 0 60px rgba(0,245,212,0.15), inset 0 0 24px rgba(255,230,0,0.06)"
                    : "none",
                }}
              >
                <span className="inline-flex items-center gap-3 skew-x-3">
                  <AnimatePresence mode="wait">
                    {battling ? (
                      <motion.span
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2.5"
                      >
                        <Loader2 className="size-4 animate-spin" />
                        模拟中...
                      </motion.span>
                    ) : (
                      <motion.span
                        key="ready"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2.5"
                      >
                        <Zap className="size-4" />
                        开始对战
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </motion.button>
            </motion.div>

            {/* 错误提示 */}
            <AnimatePresence>
              {battleError && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ border: "2px dashed #FF6B35", background: "rgba(255,107,53,0.07)" }}
                >
                  <span className="font-mono text-xs font-black" style={{ color: "#FF6B35" }}>[ERR]</span>
                  <span className="font-mono text-xs text-white/55">{battleError}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 对战结果面板（Chrome panel） */}
            <AnimatePresence>
              {battleResult && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="overflow-hidden"
                  style={{
                    border: `2px solid ${isWinner ? "rgba(0,245,212,0.35)" : "rgba(255,107,53,0.35)"}`,
                    borderTop: `2px solid ${isWinner ? "#00F5D4" : "#FF6B35"}`,
                    background: "rgba(0,0,0,0.6)",
                    boxShadow: `0 0 20px ${isWinner ? "rgba(0,245,212,0.1)" : "rgba(255,107,53,0.1)"}`,
                  }}
                >
                  {/* Chrome 标题栏 */}
                  <div
                    className="flex items-center gap-3 px-4 py-2 border-b-2"
                    style={{
                      background: isWinner ? "rgba(0,245,212,0.06)" : "rgba(255,107,53,0.06)",
                      borderColor: isWinner ? "#00F5D4" : "#FF6B35",
                    }}
                  >
                    <span className="flex gap-1.5">
                      {(isWinner
                        ? ["#00F5D4", "#FFE600", "#7B2FFF"]
                        : ["#FF6B35", "#FFE600", "#7B2FFF"]
                      ).map(c => (
                        <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                      ))}
                    </span>
                    <span
                      className="font-mono text-xs font-black uppercase tracking-[0.3em]"
                      style={{ color: isWinner ? "#00F5D4" : "#FF6B35" }}
                    >
                      {isWinner ? "VICTORY" : "DEFEAT"}
                    </span>
                    {battleResult.winner_label && (
                      <span className="font-mono text-[10px] text-white/30 ml-auto">
                        胜者：{battleResult.winner_label}
                      </span>
                    )}
                  </div>

                  <div className="px-4 py-3 flex flex-col gap-3">
                    {/* 回合数 */}
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">总回合</span>
                      <span className="font-mono text-sm font-black" style={{ color: "#FFE600" }}>
                        {battleResult.total_ticks}
                      </span>
                    </div>

                    {/* 查看完整回放 */}
                    <motion.button
                      onClick={() => router.push(`/snake/replay/${battleResult.id}`)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      className="-skew-x-3 w-full py-2 font-mono text-xs font-black uppercase tracking-[0.3em] transition-all"
                      style={{
                        border: "1px solid rgba(123,47,255,0.5)",
                        background: "rgba(123,47,255,0.1)",
                        color: "#7B2FFF",
                      }}
                    >
                      <span className="inline-block skew-x-3">查看完整回放 -&gt;</span>
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 战斗日志面板（Chrome panel） */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="overflow-hidden"
              style={{
                border: "2px solid rgba(0,245,212,0.15)",
                borderTop: "2px solid rgba(0,245,212,0.4)",
                background: "rgba(0,0,0,0.5)",
              }}
            >
              {/* Chrome 标题栏 */}
              <div
                className="flex items-center justify-between px-4 py-2 border-b"
                style={{ background: "rgba(0,245,212,0.04)", borderColor: "rgba(0,245,212,0.15)" }}
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#00F5D4" }}>
                  BATTLE.LOG
                </span>
                <span className="font-mono text-[10px] text-white/20">{logs.length}/20</span>
              </div>

              <div className="p-3 flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-white/20 text-xs font-mono uppercase tracking-wider">等待对战…</p>
                ) : (
                  logs.map(entry => (
                    <div key={entry.id} className="flex gap-2 text-xs leading-5">
                      <span className="text-white/20 font-mono shrink-0">{entry.ts}</span>
                      <span className="text-white/55 font-mono break-all">{entry.text}</span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>

          {/* ── 右栏：Canvas 回放 ── */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">

            {/* 未对战时的占位提示 */}
            {!replayData && !replayLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="flex flex-col items-center justify-center"
                style={{
                  width: CANVAS_SIZE,
                  height: CANVAS_SIZE,
                  border: "2px dashed rgba(0,245,212,0.2)",
                  background: "rgba(0,0,0,0.3)",
                }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.5em] mb-3" style={{ color: "rgba(0,245,212,0.3)" }}>
                  CANVAS_FEED.EXE
                </p>
                <p className="text-white/20 text-sm font-mono uppercase tracking-widest">选好蛇点开战</p>
                <p className="text-white/10 text-xs font-mono mt-1">Canvas 回放将在此显示</p>
              </motion.div>
            )}

            {/* 回放加载中占位 */}
            {replayLoading && (
              <div
                className="flex flex-col items-center justify-center"
                style={{
                  width: CANVAS_SIZE,
                  height: CANVAS_SIZE,
                  border: "2px solid rgba(0,245,212,0.2)",
                  background: "rgba(0,0,0,0.3)",
                }}
              >
                <Loader2 className="size-8 animate-spin mb-4" style={{ color: "#00F5D4" }} />
                <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "#00F5D4" }}>
                  LOADING_REPLAY...
                </p>
              </div>
            )}

            {/* Canvas 区域（有数据后显示） */}
            {replayData && !replayLoading && (
              <>
                {/* 播放控制栏（Chrome panel style） */}
                <div
                  className="flex items-center gap-2 px-4 py-3"
                  style={{
                    width: CANVAS_SIZE,
                    background: "rgba(0,0,0,0.5)",
                    border: "2px solid rgba(0,245,212,0.2)",
                    borderTop: "2px solid rgba(0,245,212,0.5)",
                    boxSizing: "border-box",
                  }}
                >
                  {/* 跳到首帧 */}
                  <button
                    onClick={() => { setPlaying(false); setFrameIdx(0) }}
                    className="p-1.5 hover:bg-white/10 transition"
                    title="跳到开头"
                    style={{ color: "rgba(255,255,255,0.4)" }}
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
                    className="p-2 transition shrink-0"
                    style={{
                      background: "linear-gradient(135deg,#00F5D4,#7B2FFF)",
                      boxShadow: "0 0 10px rgba(0,245,212,0.35)",
                      color: "#fff",
                    }}
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                  </button>

                  {/* 跳到末帧 */}
                  <button
                    onClick={() => { setPlaying(false); setFrameIdx(totalFrames - 1) }}
                    className="p-1.5 hover:bg-white/10 transition"
                    title="跳到结尾"
                    style={{ color: "rgba(255,255,255,0.4)" }}
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
                  <span className="font-mono text-xs tabular-nums w-20 text-right shrink-0" style={{ color: "#00F5D4" }}>
                    {frameIdx + 1} / {totalFrames}
                  </span>
                </div>

                {/* Canvas */}
                <div
                  className="relative overflow-hidden"
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

                {/* 速度控制 + 蛇图例（Chrome panel style） */}
                <div
                  className="flex items-start justify-between gap-4 px-4 py-3"
                  style={{
                    width: CANVAS_SIZE,
                    background: "rgba(0,0,0,0.5)",
                    border: "2px solid rgba(0,245,212,0.2)",
                    borderTop: "2px solid rgba(0,245,212,0.5)",
                    boxSizing: "border-box",
                  }}
                >
                  {/* 速度切换 */}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/25 mr-1">SPEED</span>
                    {SPEED_OPTIONS.map(opt => (
                      <button
                        key={opt.ms}
                        onClick={() => setSpeed(opt.ms)}
                        className="text-xs px-2.5 py-1 transition font-mono font-black"
                        style={{
                          background: speed === opt.ms ? "#00F5D4" : "rgba(0,245,212,0.05)",
                          color: speed === opt.ms ? "#000" : "rgba(255,255,255,0.35)",
                          border: speed === opt.ms ? "1px solid #00F5D4" : "1px solid rgba(0,245,212,0.15)",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* 蛇图例 */}
                  <div className="flex flex-col gap-1.5">
                    {(currentFrame?.snakes ?? replayData.telemetry[0]?.snakes ?? []).map(s => {
                      const color = SNAKE_COLORS[s.id % SNAKE_COLORS.length]
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 shrink-0"
                            style={{ background: color, boxShadow: `0 0 5px ${color}` }}
                          />
                          <span className="font-mono text-xs font-bold text-white max-w-[100px] truncate">{s.name}</span>
                          <span className="font-mono text-xs shrink-0" style={{ color: "#FFE600" }}>×{s.score}</span>
                          {!s.alive && (
                            <span
                              className="font-mono text-[10px] font-black px-1 py-0.5 shrink-0"
                              style={{ background: "rgba(255,107,53,0.15)", color: "#FF6B35" }}
                            >
                              DEAD
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
