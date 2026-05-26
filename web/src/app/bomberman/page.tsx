"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { Play, Pause, SkipBack, SkipForward, Loader2, Zap, ChevronDown, ChevronUp } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── Canvas 常量 ────────────────────────────────────────────────
const TILE = 40
const GRID = 13
const CANVAS_SIZE = TILE * GRID  // 520

const PLAYER_COLORS = ["#00F5D4", "#FF3AF2"]

const SPEED_OPTIONS: { label: string; ms: number }[] = [
  { label: "×0.5", ms: 300 },
  { label: "×1",   ms: 150 },
  { label: "×2",   ms:  75 },
  { label: "×5",   ms:  25 },
]

const OPPONENT_OPTIONS = [
  { value: "random", label: "随机 (Random)" },
  { value: "chaser", label: "追击者 (Chaser)" },
  { value: "mirror", label: "镜像 (Mirror)" },
]

const DEFAULT_CODE = `// 炸弹人 AI — 每回合调用 onIdle
// me.position = [col, row], me.move("north"/"south"/"east"/"west"), me.bomb()
// game.map[row][col]: 'x'=墙, 'm'=砖块, '.'=空地
// game.bombs = [[col, row, fuse, range], ...]
// game.items = [[col, row, "F"|"B"], ...]

function onIdle(me, others, game) {
    var pos = me.position;
    var dirs = ["north", "south", "east", "west"];
    var deltas = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] };

    // 如果能放炸弹且旁边有砖块，优先放炸弹
    if (me.bomb_count < me.max_bombs) {
        for (var k = 0; k < dirs.length; k++) {
            var d = deltas[dirs[k]];
            var nx = pos[0] + d[0], ny = pos[1] + d[1];
            if (ny >= 0 && ny < game.map.length && nx >= 0 && nx < game.map[ny].length) {
                if (game.map[ny][nx] === 'm') {
                    me.bomb();
                    return;
                }
            }
        }
    }

    // 避开爆炸：如果当前格有炸弹威胁，逃跑
    var inDanger = false;
    for (var i = 0; i < game.bombs.length; i++) {
        var b = game.bombs[i];
        if (b[0] === pos[0] || b[1] === pos[1]) {
            if (Math.abs(b[0]-pos[0]) + Math.abs(b[1]-pos[1]) <= b[3]) {
                inDanger = true;
                break;
            }
        }
    }

    // 找一个安全且可通行的方向
    var bestDirs = inDanger ? ["north","south","east","west"] : dirs;
    for (var j = 0; j < bestDirs.length; j++) {
        var dd = deltas[bestDirs[j]];
        var mx = pos[0] + dd[0], my = pos[1] + dd[1];
        if (my < 0 || my >= game.map.length || mx < 0 || mx >= game.map[my].length) continue;
        var cell = game.map[my][mx];
        if (cell === '.' || cell === 'o') {
            me.move(bestDirs[j]);
            return;
        }
    }
}`

// ── 类型定义 ───────────────────────────────────────────────────
interface BomberPlayer {
  id: number
  name: string
  position: [number, number]
  alive: boolean
  score: number
  bomb_count: number
  max_bombs: number
  bomb_range: number
}

interface BomberBomb {
  position: [number, number]
  owner: number
  fuse: number
  range: number
}

interface BomberItem {
  position: [number, number]
  item_type: "F" | "B"
}

interface BomberFrame {
  tick: number
  players: BomberPlayer[]
  bombs: BomberBomb[]
  items: BomberItem[]
  explosions: [number, number][]
  map: string[]
}

interface BomberResult {
  winner: string
  winner_label: string
  total_ticks: number
  timed_out: boolean
  map: string[]
  telemetry: BomberFrame[]
  battle_log: string[]
}

// ── Canvas 渲染 ────────────────────────────────────────────────
function drawBomberFrame(ctx: CanvasRenderingContext2D, frame: BomberFrame) {
  // 1. 地板 + 墙 + 砖块
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const ch = frame.map[row]?.[col] ?? "."
      const x = col * TILE
      const y = row * TILE

      if (ch === "x") {
        ctx.fillStyle = "#1a1a2e"
        ctx.fillRect(x, y, TILE, TILE)
        ctx.strokeStyle = "#2a2a4e"
        ctx.lineWidth = 1
        ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4)
        ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12)
      } else if (ch === "m") {
        const grad = ctx.createLinearGradient(x, y, x + TILE, y + TILE)
        grad.addColorStop(0, "#8B4A35")
        grad.addColorStop(1, "#5A2A1A")
        ctx.fillStyle = grad
        ctx.fillRect(x, y, TILE, TILE)
        ctx.fillStyle = "rgba(255,180,100,0.18)"
        ctx.fillRect(x + 3, y + 3, TILE - 6, 6)
        ctx.fillRect(x + 3, y + 3, 6, TILE - 6)
        ctx.strokeStyle = "#3d1f10"
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1)
      } else {
        ctx.fillStyle = "#0d0d1a"
        ctx.fillRect(x, y, TILE, TILE)
      }
    }
  }

  // 2. 网格线
  ctx.strokeStyle = "rgba(255,255,255,0.025)"
  ctx.lineWidth = 0.5
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath()
    ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, CANVAS_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * TILE); ctx.lineTo(CANVAS_SIZE, i * TILE)
    ctx.stroke()
  }

  // 3. 道具
  for (const item of frame.items) {
    const [ic, ir] = item.position
    const ix = ic * TILE + TILE / 2
    const iy = ir * TILE + TILE / 2
    const size = 10
    ctx.fillStyle = item.item_type === "F" ? "#FF3AF2" : "#00F5D4"
    ctx.shadowColor = item.item_type === "F" ? "#FF3AF2" : "#00F5D4"
    ctx.shadowBlur = 8
    ctx.fillRect(ix - size / 2, iy - size / 2, size, size)
    ctx.shadowBlur = 0
    ctx.fillStyle = "#fff"
    ctx.font = "bold 8px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(item.item_type, ix, iy)
  }

  // 4. 爆炸效果
  for (const [ec, er] of frame.explosions) {
    ctx.fillStyle = "rgba(255,107,53,0.65)"
    ctx.fillRect(ec * TILE, er * TILE, TILE, TILE)
    ctx.fillStyle = "rgba(255,230,0,0.35)"
    ctx.fillRect(ec * TILE + 4, er * TILE + 4, TILE - 8, TILE - 8)
  }

  // 5. 炸弹
  for (const bomb of frame.bombs) {
    const [bc, br] = bomb.position
    const bx = bc * TILE + TILE / 2
    const by = br * TILE + TILE / 2
    const ownerColor = PLAYER_COLORS[bomb.owner % PLAYER_COLORS.length]

    ctx.beginPath()
    ctx.arc(bx, by, 12, 0, Math.PI * 2)
    ctx.fillStyle = "#111"
    ctx.fill()
    ctx.strokeStyle = ownerColor
    ctx.lineWidth = 2.5
    ctx.shadowColor = ownerColor
    ctx.shadowBlur = 8
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.fillStyle = "#fff"
    ctx.font = "bold 11px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(String(bomb.fuse), bx, by)
  }

  // 6. 玩家
  for (const player of frame.players) {
    const [pc, pr] = player.position
    const px = pc * TILE
    const py = pr * TILE
    const color = PLAYER_COLORS[player.id % PLAYER_COLORS.length]
    const pad = 5
    const size = TILE - pad * 2

    if (!player.alive) {
      ctx.globalAlpha = 0.25
      ctx.fillStyle = "#888"
      ctx.fillRect(px + pad, py + pad, size, size)
      ctx.globalAlpha = 1
      continue
    }

    ctx.shadowColor = color
    ctx.shadowBlur = 10
    ctx.fillStyle = color
    const r = 6
    ctx.beginPath()
    ctx.moveTo(px + pad + r, py + pad)
    ctx.lineTo(px + pad + size - r, py + pad)
    ctx.quadraticCurveTo(px + pad + size, py + pad, px + pad + size, py + pad + r)
    ctx.lineTo(px + pad + size, py + pad + size - r)
    ctx.quadraticCurveTo(px + pad + size, py + pad + size, px + pad + size - r, py + pad + size)
    ctx.lineTo(px + pad + r, py + pad + size)
    ctx.quadraticCurveTo(px + pad, py + pad + size, px + pad, py + pad + size - r)
    ctx.lineTo(px + pad, py + pad + r)
    ctx.quadraticCurveTo(px + pad, py + pad, px + pad + r, py + pad)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0

    // 名字缩写
    ctx.fillStyle = "#000"
    ctx.font = "bold 12px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const abbr = player.name.slice(0, 2).toUpperCase()
    ctx.fillText(abbr, px + TILE / 2, py + TILE / 2)
  }
}

// ── 主页面 ─────────────────────────────────────────────────────
export default function BombermanPage() {
  const [code, setCode] = useState(DEFAULT_CODE)
  const [playerName, setPlayerName] = useState("my_bomber")
  const [opponent, setOpponent] = useState("random")

  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle")
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BomberResult | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameIdxRef = useRef(0)
  const playingRef = useRef(false)
  const resultRef = useRef<BomberResult | null>(null)

  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(150)

  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { resultRef.current = result }, [result])

  const render = useCallback((idx: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const d = resultRef.current
    if (!d || !d.telemetry[idx]) return
    drawBomberFrame(ctx, d.telemetry[idx])
  }, [])

  useEffect(() => { render(frameIdx) }, [frameIdx, render, result])

  useEffect(() => {
    if (animRef.current) clearTimeout(animRef.current)
    if (!playing || !result) return
    const step = () => {
      const next = frameIdxRef.current + 1
      const total = resultRef.current?.telemetry.length ?? 0
      if (next >= total) { setPlaying(false); return }
      setFrameIdx(next)
      animRef.current = setTimeout(step, speed)
    }
    animRef.current = setTimeout(step, speed)
    return () => { if (animRef.current) clearTimeout(animRef.current) }
  }, [playing, speed, result])

  async function handleRun() {
    const name = playerName.trim() || "my_bomber"
    setStatus("loading")
    setError(null)
    setResult(null)
    setFrameIdx(0)
    setPlaying(false)

    try {
      const res = await fetch(`${apiBase}/api/bomberman/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_name: name, player_code: code, opponent }),
      })
      const data = await res.json() as BomberResult & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
      setStatus("done")
      setFrameIdx(0)
      setTimeout(() => setPlaying(true), 300)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
      setStatus("idle")
    }
  }

  const totalFrames = result?.telemetry.length ?? 0
  const currentFrame = result?.telemetry[frameIdx]
  const isWinner = result && result.winner === (playerName.trim() || "my_bomber")

  return (
    <main className="relative min-h-screen bg-[#0D0D1A] text-white px-4 py-8 overflow-hidden">

      {/* 背景层 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 size-[600px] opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, #FF6B35 0%, #7B2FFF 45%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-56 opacity-[0.1]"
        style={{
          backgroundImage: [
            "linear-gradient(transparent 94%, #FF6B35 94%)",
            "linear-gradient(90deg, transparent 94%, #FF6B35 94%)",
          ].join(", "),
          backgroundSize: "36px 36px",
          transform: "perspective(350px) rotateX(55deg) translateY(50px) scale(2.5)",
          transformOrigin: "bottom center",
          maskImage: "linear-gradient(to top, black 5%, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to top, black 5%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto">

        {/* 标题行 */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8"
        >
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.5em] mb-1" style={{ color: "#FF6B35" }}>
            &gt; BOMBERMAN_ARENA.SYS
          </p>
          <h1
            className="text-5xl font-black uppercase tracking-tighter text-white"
            style={{ fontFamily: "var(--font-outfit)", textShadow: "3px 3px 0 #7B2FFF, 6px 6px 0 #FF6B35" }}
          >
            炸弹人竞技场
          </h1>
          <p className="text-white/35 text-sm mt-1 font-mono">编写 AI，放置炸弹，炸毁对手</p>
        </motion.div>

        {/* 主体区域：左侧编辑器 + 右侧控制 + 下方 Canvas */}
        <div className="flex gap-6 items-start flex-wrap xl:flex-nowrap">

          {/* 左侧：Monaco 编辑器 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="flex-1 min-w-0 flex flex-col gap-0 overflow-hidden"
            style={{
              border: "2px solid rgba(255,107,53,0.35)",
              borderTop: "2px solid #FF6B35",
              background: "rgba(0,0,0,0.6)",
              boxShadow: "0 0 20px rgba(255,107,53,0.1)",
            }}
          >
            <div
              className="flex items-center gap-3 px-4 py-2 border-b-2"
              style={{ background: "rgba(255,107,53,0.06)", borderColor: "#FF6B35" }}
            >
              <span className="flex gap-1.5">
                {(["#FF6B35", "#FFE600", "#7B2FFF"] as const).map(c => (
                  <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                ))}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#FF6B35" }}>
                AGENT_CODE.JS
              </span>
            </div>
            <MonacoEditor
              height="520px"
              language="javascript"
              theme="vs-dark"
              value={code}
              onChange={v => setCode(v ?? "")}
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                wordWrap: "on",
                padding: { top: 12 },
              }}
            />
          </motion.div>

          {/* 右侧：控制面板 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
            className="w-full xl:w-[280px] shrink-0 flex flex-col gap-4"
          >
            {/* 对战配置面板 */}
            <div
              className="overflow-hidden"
              style={{
                border: "2px solid rgba(255,107,53,0.35)",
                borderTop: "2px solid #FF6B35",
                background: "rgba(0,0,0,0.6)",
                boxShadow: "0 0 20px rgba(255,107,53,0.1)",
              }}
            >
              <div
                className="flex items-center gap-3 px-4 py-2 border-b-2"
                style={{ background: "rgba(255,107,53,0.06)", borderColor: "#FF6B35" }}
              >
                <span className="flex gap-1.5">
                  {(["#FF6B35", "#FFE600", "#7B2FFF"] as const).map(c => (
                    <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                  ))}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#FF6B35" }}>
                  BATTLE_CONFIG.DAT
                </span>
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 mb-2 block">
                    玩家名称
                  </label>
                  <input
                    value={playerName}
                    onChange={e => setPlayerName(e.target.value)}
                    placeholder="my_bomber"
                    className="w-full font-mono text-xs bg-black/60 focus:outline-none px-3 py-2 text-white placeholder:text-white/25"
                    style={{ border: "2px solid rgba(255,107,53,0.4)", color: "#FF6B35" }}
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 mb-2 block">
                    对手类型
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {OPPONENT_OPTIONS.map(opt => {
                      const active = opponent === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setOpponent(opt.value)}
                          className="text-left px-3 py-2 font-mono text-xs transition-all duration-150"
                          style={{
                            border: `2px ${active ? "solid" : "dashed"} ${active ? "#FF6B35" : "rgba(255,107,53,0.25)"}`,
                            background: active ? "rgba(255,107,53,0.12)" : "transparent",
                            color: active ? "#FF6B35" : "rgba(255,255,255,0.4)",
                            boxShadow: active ? "0 0 10px rgba(255,107,53,0.2)" : "none",
                          }}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* 开战按钮 */}
            <motion.button
              onClick={handleRun}
              disabled={status === "loading"}
              whileHover={status !== "loading" ? { scale: 1.02 } : {}}
              whileTap={status !== "loading" ? { scale: 0.97 } : {}}
              className="relative w-full -skew-x-3 overflow-hidden font-mono font-black uppercase transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                height: 64,
                border: "2px solid #FFE600",
                background: status !== "loading"
                  ? "linear-gradient(135deg, #FF6B35 0%, #7B2FFF 50%, #FF6B35 100%)"
                  : "rgba(255,107,53,0.05)",
                color: "#FFE600",
                letterSpacing: "0.35em",
                fontSize: 15,
                boxShadow: status !== "loading"
                  ? "0 0 30px rgba(255,107,53,0.45), 0 0 60px rgba(255,107,53,0.15)"
                  : "none",
              }}
            >
              <span className="inline-flex items-center gap-3 skew-x-3">
                <AnimatePresence mode="wait">
                  {status === "loading" ? (
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

            {/* 错误提示 */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ border: "2px dashed #FF6B35", background: "rgba(255,107,53,0.07)" }}
                >
                  <span className="font-mono text-xs font-black" style={{ color: "#FF6B35" }}>[ERR]</span>
                  <span className="font-mono text-xs text-white/55">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 结果面板 */}
            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="overflow-hidden"
                  style={{
                    border: `2px solid ${isWinner ? "rgba(255,230,0,0.35)" : "rgba(255,107,53,0.35)"}`,
                    borderTop: `2px solid ${isWinner ? "#FFE600" : "#FF6B35"}`,
                    background: "rgba(0,0,0,0.6)",
                    boxShadow: `0 0 20px ${isWinner ? "rgba(255,230,0,0.12)" : "rgba(255,107,53,0.1)"}`,
                  }}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-2 border-b-2"
                    style={{
                      background: isWinner ? "rgba(255,230,0,0.06)" : "rgba(255,107,53,0.06)",
                      borderColor: isWinner ? "#FFE600" : "#FF6B35",
                    }}
                  >
                    <span className="flex gap-1.5">
                      {(isWinner
                        ? ["#FFE600", "#FF6B35", "#7B2FFF"]
                        : ["#FF6B35", "#FFE600", "#7B2FFF"]
                      ).map(c => (
                        <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                      ))}
                    </span>
                    <span
                      className="font-mono text-xs font-black uppercase tracking-[0.3em]"
                      style={{ color: isWinner ? "#FFE600" : "#FF6B35" }}
                    >
                      {isWinner ? "VICTORY" : "DEFEAT"}
                    </span>
                    {result.timed_out && (
                      <span className="font-mono text-[10px] text-white/30 ml-auto">TIMEOUT</span>
                    )}
                  </div>
                  <div className="px-4 py-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">胜者</span>
                      <span className="font-mono text-xs font-black" style={{ color: "#FFE600" }}>{result.winner_label}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">总回合</span>
                      <span className="font-mono text-sm font-black" style={{ color: "#FF6B35" }}>{result.total_ticks}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 玩家图例（有回放数据时） */}
            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="overflow-hidden"
                  style={{
                    border: "2px solid rgba(255,107,53,0.2)",
                    borderTop: "2px solid rgba(255,107,53,0.5)",
                    background: "rgba(0,0,0,0.5)",
                  }}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-2 border-b"
                    style={{ background: "rgba(255,107,53,0.04)", borderColor: "rgba(255,107,53,0.2)" }}
                  >
                    <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#FF6B35" }}>
                      PLAYERS.DAT
                    </span>
                  </div>
                  <div className="p-3 flex flex-col gap-2">
                    {(currentFrame?.players ?? result.telemetry[0]?.players ?? []).map(p => {
                      const color = PLAYER_COLORS[p.id % PLAYER_COLORS.length]
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 shrink-0 rounded-sm" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                          <span className="font-mono text-xs font-bold text-white truncate max-w-[100px]">{p.name}</span>
                          <span className="font-mono text-xs ml-auto shrink-0" style={{ color: "#FFE600" }}>×{currentFrame?.players.find(x => x.id === p.id)?.score ?? p.score}</span>
                          {!(currentFrame?.players.find(x => x.id === p.id)?.alive ?? p.alive) && (
                            <span className="font-mono text-[10px] font-black px-1 py-0.5 shrink-0" style={{ background: "rgba(255,107,53,0.15)", color: "#FF6B35" }}>
                              DEAD
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Canvas 回放区域 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.18 }}
          className="mt-6"
        >
          {/* 空状态提示 */}
          {!result && status !== "loading" && (
            <div
              className="flex flex-col items-center justify-center"
              style={{
                width: CANVAS_SIZE,
                height: CANVAS_SIZE,
                border: "2px dashed rgba(255,107,53,0.2)",
                background: "rgba(0,0,0,0.3)",
              }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.5em] mb-3" style={{ color: "rgba(255,107,53,0.3)" }}>
                CANVAS_FEED.EXE
              </p>
              <p className="text-white/20 text-sm font-mono uppercase tracking-widest">编写代码，点击开始对战</p>
              <p className="text-white/10 text-xs font-mono mt-1">13×13 格地图回放将在此显示</p>
            </div>
          )}

          {/* 加载中 */}
          {status === "loading" && (
            <div
              className="flex flex-col items-center justify-center"
              style={{
                width: CANVAS_SIZE,
                height: CANVAS_SIZE,
                border: "2px solid rgba(255,107,53,0.25)",
                background: "rgba(0,0,0,0.3)",
              }}
            >
              <Loader2 className="size-8 animate-spin mb-4" style={{ color: "#FF6B35" }} />
              <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "#FF6B35" }}>
                SIMULATING...
              </p>
            </div>
          )}

          {/* 有回放数据 */}
          {result && (
            <div className="flex flex-col gap-0" style={{ width: CANVAS_SIZE }}>
              {/* 播放控制栏 */}
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: "2px solid rgba(255,107,53,0.2)",
                  borderTop: "2px solid rgba(255,107,53,0.5)",
                  borderBottom: "none",
                  boxSizing: "border-box",
                }}
              >
                <button
                  onClick={() => { setPlaying(false); setFrameIdx(0) }}
                  className="p-1.5 hover:bg-white/10 transition"
                  title="跳到开头"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  <SkipBack size={14} />
                </button>

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
                    background: "linear-gradient(135deg,#FF6B35,#7B2FFF)",
                    boxShadow: "0 0 10px rgba(255,107,53,0.35)",
                    color: "#fff",
                  }}
                >
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>

                <button
                  onClick={() => { setPlaying(false); setFrameIdx(totalFrames - 1) }}
                  className="p-1.5 hover:bg-white/10 transition"
                  title="跳到结尾"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  <SkipForward size={14} />
                </button>

                <input
                  type="range"
                  min={0}
                  max={Math.max(0, totalFrames - 1)}
                  value={frameIdx}
                  onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)) }}
                  className="flex-1 accent-[#FF6B35]"
                />

                <span className="font-mono text-xs tabular-nums w-20 text-right shrink-0" style={{ color: "#FF6B35" }}>
                  {frameIdx + 1} / {totalFrames}
                </span>
              </div>

              {/* Canvas */}
              <div
                className="relative overflow-hidden"
                style={{
                  width: CANVAS_SIZE,
                  height: CANVAS_SIZE,
                  border: "2px solid rgba(255,107,53,0.25)",
                  boxShadow: "0 0 30px rgba(255,107,53,0.08)",
                }}
              >
                <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="block" />
              </div>

              {/* 速度控制 */}
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: "2px solid rgba(255,107,53,0.2)",
                  borderTop: "2px solid rgba(255,107,53,0.5)",
                  boxSizing: "border-box",
                }}
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-white/25 mr-1">SPEED</span>
                {SPEED_OPTIONS.map(opt => (
                  <button
                    key={opt.ms}
                    onClick={() => setSpeed(opt.ms)}
                    className="text-xs px-2.5 py-1 transition font-mono font-black"
                    style={{
                      background: speed === opt.ms ? "#FF6B35" : "rgba(255,107,53,0.05)",
                      color: speed === opt.ms ? "#000" : "rgba(255,255,255,0.35)",
                      border: speed === opt.ms ? "1px solid #FF6B35" : "1px solid rgba(255,107,53,0.15)",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <span className="ml-auto font-mono text-[10px] text-white/20">
                  TICK {currentFrame?.tick ?? 0}
                </span>
              </div>
            </div>
          )}
        </motion.div>

        {/* 战报日志（可折叠） */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-6 overflow-hidden"
              style={{
                border: "2px solid rgba(255,107,53,0.2)",
                borderTop: "2px solid rgba(255,107,53,0.5)",
                background: "rgba(0,0,0,0.5)",
                maxWidth: CANVAS_SIZE,
              }}
            >
              <button
                onClick={() => setLogOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 transition-colors duration-100"
                style={{ background: "rgba(255,107,53,0.04)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,107,53,0.08)" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,107,53,0.04)" }}
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#FF6B35" }}>
                  BATTLE.LOG
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-white/20">{result.battle_log.length} 条</span>
                  {logOpen ? <ChevronUp size={14} style={{ color: "#FF6B35" }} /> : <ChevronDown size={14} style={{ color: "#FF6B35" }} />}
                </div>
              </button>

              <AnimatePresence>
                {logOpen && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
                      {result.battle_log.map((line, i) => (
                        <div key={i} className="font-mono text-[11px] text-white/45 leading-5 break-all">
                          {line}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  )
}
