"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Play, Pause, SkipForward, SkipBack, Zap, ChevronRight } from "lucide-react"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

const TILE = 30
const GRID = 20
const CANVAS_SIZE = TILE * GRID  // 600

const SNAKE_COLORS = ["#00F5D4", "#7B2FFF", "#FF8C00", "#FF3AF2"]
const FOOD_COLOR   = "#FFE600"

const TILE_COLORS: Record<string, string> = {
  "x": "#1a1a2e",
  "m": "#3d2b1f",
  "o": "#1a3320",
  ".": "#0d0d1a",
}

const DEFAULT_CODE = `// 贪吃蛇 AI — 每回合调用 onIdle
// me.head: [col, row]   当前头部坐标
// me.body: [[col,row],...]  完整身体（body[0]=头）
// me.direction: "north"|"east"|"south"|"west"
// me.length: 身体长度   me.score: 当前得分
// others: 其他存活蛇的数组（同 me 字段结构）
// game.map: string[]   地图行（'x'=墙 'm'=土堆 'o'=草丛 '.'=地板）
// game.food: [[col,row],...]  食物坐标列表
// game.tick: 当前回合数

function onIdle(me, others, game) {
  var head = me.head;
  var food = game.food;

  // 找最近食物
  var target = null;
  var minDist = 999;
  for (var i = 0; i < food.length; i++) {
    var d = Math.abs(food[i][0] - head[0]) + Math.abs(food[i][1] - head[1]);
    if (d < minDist) { minDist = d; target = food[i]; }
  }

  var dirs = [];
  if (target) {
    var dx = target[0] - head[0];
    var dy = target[1] - head[1];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 0) dirs.push("east"); else if (dx < 0) dirs.push("west");
      if (dy > 0) dirs.push("south"); else if (dy < 0) dirs.push("north");
    } else {
      if (dy > 0) dirs.push("south"); else if (dy < 0) dirs.push("north");
      if (dx > 0) dirs.push("east"); else if (dx < 0) dirs.push("west");
    }
  }

  var all = ["north", "east", "south", "west"];
  for (var k = 0; k < all.length; k++) {
    if (dirs.indexOf(all[k]) < 0) dirs.push(all[k]);
  }

  for (var j = 0; j < dirs.length; j++) {
    if (isSafe(head, dirs[j], me, others, game)) {
      me.setDir(dirs[j]);
      return;
    }
  }
}

function isSafe(head, dir, me, others, game) {
  var nx = head[0], ny = head[1];
  if (dir === "north") ny--; else if (dir === "south") ny++;
  else if (dir === "east") nx++; else if (dir === "west") nx--;
  if (nx < 0 || ny < 0 || nx >= 20 || ny >= 20) return false;
  var cell = game.map[ny][nx];
  if (cell === "x" || cell === "m") return false;
  for (var i = 0; i < me.body.length - 1; i++) {
    if (me.body[i][0] === nx && me.body[i][1] === ny) return false;
  }
  for (var j = 0; j < others.length; j++) {
    for (var k = 0; k < others[j].body.length; k++) {
      if (others[j].body[k][0] === nx && others[j].body[k][1] === ny) return false;
    }
  }
  return true;
}`

interface SnakeSnapshot {
  id: number; name: string; body: [number, number][]
  alive: boolean; score: number; direction: string
}
interface SnakeFrame {
  tick: number; snakes: SnakeSnapshot[]; food: [number, number][]
}
interface SnakeResult {
  winner: string; winner_label: string; total_ticks: number; timed_out: boolean
  arena: { map: string[]; width: number; height: number }
  telemetry: SnakeFrame[]; battle_log: string[]
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  mapStr: string[],
  frame: SnakeFrame,
) {
  // 地图背景
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const ch = mapStr[row]?.[col] ?? "."
      ctx.fillStyle = TILE_COLORS[ch] ?? TILE_COLORS["."]
      ctx.fillRect(col * TILE, row * TILE, TILE, TILE)
    }
  }

  // 网格线（细）
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

  // 食物
  for (const [fx, fy] of frame.food) {
    ctx.fillStyle = FOOD_COLOR
    ctx.beginPath()
    ctx.arc(fx * TILE + TILE / 2, fy * TILE + TILE / 2, TILE / 3, 0, Math.PI * 2)
    ctx.fill()
    // 发光效果
    ctx.shadowColor = FOOD_COLOR
    ctx.shadowBlur = 8
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

      ctx.fillStyle = color
      ctx.globalAlpha = alpha
      const pad = isHead ? 2 : 4
      ctx.fillRect(x * TILE + pad, y * TILE + pad, TILE - pad * 2, TILE - pad * 2)
      ctx.globalAlpha = 1

      // 蛇头：眼睛
      if (isHead) {
        ctx.fillStyle = "#fff"
        const eyeSize = 3
        const { dir } = getEyeOffsets(snake.direction)
        ctx.fillRect(
          x * TILE + TILE / 2 + dir.ex1 - eyeSize / 2,
          y * TILE + TILE / 2 + dir.ey1 - eyeSize / 2,
          eyeSize, eyeSize
        )
        ctx.fillRect(
          x * TILE + TILE / 2 + dir.ex2 - eyeSize / 2,
          y * TILE + TILE / 2 + dir.ey2 - eyeSize / 2,
          eyeSize, eyeSize
        )
      }
    }
  }
}

function getEyeOffsets(direction: string) {
  const e = 5
  const offsets: Record<string, { ex1: number; ey1: number; ex2: number; ey2: number }> = {
    east:  { ex1:  e, ey1: -e, ex2:  e, ey2:  e },
    west:  { ex1: -e, ey1: -e, ex2: -e, ey2:  e },
    north: { ex1: -e, ey1: -e, ex2:  e, ey2: -e },
    south: { ex1: -e, ey1:  e, ex2:  e, ey2:  e },
  }
  return { dir: offsets[direction] ?? offsets.east }
}

export default function SnakePage() {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const animRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [code,        setCode]        = useState(DEFAULT_CODE)
  const [name,        setName]        = useState("my_snake")
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [result,      setResult]      = useState<SnakeResult | null>(null)
  const [frameIdx,    setFrameIdx]    = useState(0)
  const [playing,     setPlaying]     = useState(false)
  const [speed,       setSpeed]       = useState(120)  // ms / frame

  const frameIdxRef = useRef(0)
  const playingRef  = useRef(false)
  const resultRef   = useRef<SnakeResult | null>(null)

  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { resultRef.current = result }, [result])

  // Canvas 渲染
  const render = useCallback((idx: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const res = resultRef.current
    if (!res || !res.telemetry[idx]) return
    drawFrame(ctx, res.arena.map, res.telemetry[idx])
  }, [])

  useEffect(() => { render(frameIdx) }, [frameIdx, render, result])

  // 动画循环
  useEffect(() => {
    if (animRef.current) clearTimeout(animRef.current)
    if (!playing || !result) return

    const step = () => {
      const next = frameIdxRef.current + 1
      if (next >= (resultRef.current?.telemetry.length ?? 0)) {
        setPlaying(false)
        return
      }
      setFrameIdx(next)
      animRef.current = setTimeout(step, speed)
    }
    animRef.current = setTimeout(step, speed)
    return () => { if (animRef.current) clearTimeout(animRef.current) }
  }, [playing, speed, result])

  async function runBattle() {
    setLoading(true)
    setError(null)
    setResult(null)
    setFrameIdx(0)
    setPlaying(false)

    try {
      const res = await fetch(`${apiBase}/api/snake/battle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "my_snake", code }),
      })
      const data: SnakeResult = await res.json()
      if (!res.ok) { setError((data as unknown as { error: string }).error ?? "请求失败"); return }
      setResult(data)
      setFrameIdx(0)
      setTimeout(() => setPlaying(true), 200)
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误")
    } finally {
      setLoading(false)
    }
  }

  const totalFrames = result?.telemetry.length ?? 0

  return (
    <main className="min-h-screen bg-[#0D0D1A] text-white px-4 py-8">
      <div className="max-w-6xl mx-auto">

        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#00F5D4]">
            贪吃蛇 AI 竞技场
          </h1>
          <p className="text-white/40 text-sm mt-1">
            编写 JS 控制贪吃蛇，对战内置 Bot
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* 左栏：代码编辑器 */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="蛇的名字"
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-[#00F5D4]"
              />
              <button
                onClick={runBattle}
                disabled={loading}
                className="flex items-center gap-2 bg-[#00F5D4] text-black font-bold text-sm px-5 py-2 rounded-lg hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {loading
                  ? <><span className="animate-spin">⟳</span> 仿真中…</>
                  : <><Zap size={14} /> 开始对战</>
                }
              </button>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
              className="font-mono text-xs bg-black/40 border border-white/10 rounded-lg p-4 resize-none focus:outline-none focus:border-[#00F5D4]/50 text-[#cdd6f4] leading-relaxed"
              style={{ height: "520px" }}
            />

            {/* JS 接口说明 */}
            <div className="bg-white/3 border border-white/8 rounded-lg p-4 text-xs text-white/50 space-y-1">
              <div className="text-[#00F5D4] font-bold mb-2">JS 接口</div>
              <div><span className="text-[#7B2FFF]">me.setDir</span>(<span className="text-[#FFE600]">"north"|"east"|"south"|"west"</span>)</div>
              <div><span className="text-white/70">me.head</span> — [col, row]，<span className="text-white/70">me.body</span> — 完整身体</div>
              <div><span className="text-white/70">me.score</span> — 得分，<span className="text-white/70">me.length</span> — 当前长度</div>
              <div><span className="text-white/70">game.food</span> — 食物坐标列表</div>
              <div><span className="text-white/70">game.map</span>[row][col] — 格子类型</div>
            </div>
          </div>

          {/* 右栏：Canvas 回放 */}
          <div className="flex flex-col gap-4">
            {/* 得分面板 */}
            {result && (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                <span className="text-sm font-bold text-[#FFE600]">{result.winner_label}</span>
                <span className="text-xs text-white/40">
                  共 {result.total_ticks} 回合 · {result.timed_out ? "超时判定" : "正常结束"}
                </span>
              </div>
            )}

            {/* Canvas */}
            <div className="relative rounded-xl overflow-hidden border border-white/10" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className="block"
              />
              {!result && !loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="text-center">
                    <div className="text-4xl mb-3">🐍</div>
                    <p className="text-white/40 text-sm">运行对战后在此回放</p>
                  </div>
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center">
                    <div className="text-2xl animate-pulse mb-2">🐍</div>
                    <p className="text-[#00F5D4] text-sm">仿真中…</p>
                  </div>
                </div>
              )}
            </div>

            {/* 图例 */}
            {result && (
              <div className="flex gap-3 flex-wrap">
                {result.telemetry[frameIdx]?.snakes.map(s => (
                  <div key={s.id} className="flex items-center gap-1.5 text-xs">
                    <div className="w-3 h-3 rounded-sm" style={{ background: SNAKE_COLORS[s.id % SNAKE_COLORS.length] }} />
                    <span className="text-white/60">{s.name}</span>
                    <span className="text-[#FFE600]">×{s.score}</span>
                    {!s.alive && <span className="text-red-400">💀</span>}
                  </div>
                ))}
              </div>
            )}

            {/* 播放控制 */}
            {result && totalFrames > 0 && (
              <div className="space-y-3">
                {/* 进度条 */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/30 w-12 text-right">{frameIdx}</span>
                  <input
                    type="range" min={0} max={totalFrames - 1} value={frameIdx}
                    onChange={e => { setPlaying(false); setFrameIdx(+e.target.value) }}
                    className="flex-1 accent-[#00F5D4]"
                  />
                  <span className="text-xs text-white/30 w-12">{totalFrames - 1}</span>
                </div>

                {/* 按钮行 */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => { setPlaying(false); setFrameIdx(0) }}
                    className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition"
                  ><SkipBack size={16} /></button>

                  <button
                    onClick={() => setPlaying(p => !p)}
                    className="p-3 rounded-xl bg-[#00F5D4]/20 border border-[#00F5D4]/40 text-[#00F5D4] hover:bg-[#00F5D4]/30 transition"
                  >
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                  </button>

                  <button
                    onClick={() => { setPlaying(false); setFrameIdx(totalFrames - 1) }}
                    className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition"
                  ><SkipForward size={16} /></button>

                  {/* 速度 */}
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs text-white/30">速度</span>
                    {[200, 120, 60, 20].map(ms => (
                      <button
                        key={ms}
                        onClick={() => setSpeed(ms)}
                        className={`text-xs px-2 py-1 rounded transition ${speed === ms ? "bg-[#7B2FFF] text-white" : "text-white/40 hover:text-white"}`}
                      >
                        {ms === 200 ? "×0.5" : ms === 120 ? "×1" : ms === 60 ? "×2" : "×5"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 战斗日志 */}
            {result && (
              <div className="bg-black/40 border border-white/10 rounded-lg p-3 h-40 overflow-y-auto">
                <div className="text-xs text-white/30 mb-2 font-bold uppercase tracking-wider">战斗日志</div>
                {result.battle_log.map((line, i) => (
                  <div key={i} className="text-xs text-white/50 leading-5 font-mono">{line}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
