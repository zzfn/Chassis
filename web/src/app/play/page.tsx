"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import * as PIXI from "pixi.js"

// ── 数据类型 ──────────────────────────────────────────────────
interface TankSnapshot {
  id: number; name: string; x: number; y: number
  body_angle: number; hp: number; alive: boolean; score: number
}
interface BulletSnapshot { id: number; x: number; y: number; owner_id: number }
interface StarSnapshot { x: number; y: number }

interface FrameData {
  tick: number
  tanks: TankSnapshot[]
  bullets: BulletSnapshot[]
  stars: StarSnapshot[]
}

interface ArenaInfo {
  map: string[]
  width: number
  height: number
}

type GameStatus = "connecting" | "playing" | "ended" | "disconnected"

// ── 常量 ──────────────────────────────────────────────────────
const WORLD = 800
const TILE  = 40
const VIEW  = 560
const S     = VIEW / WORLD  // 0.7
const TS    = TILE * S      // 28px

const PALETTE = [
  { body: 0x3b82f6, dark: 0x1e3a8a },  // 蓝色：玩家 id=0
  { body: 0xef4444, dark: 0x7f1d1d },  // 红色：AI id=1
  { body: 0x22c55e, dark: 0x14532d },
  { body: 0xa78bfa, dark: 0x4c1d95 },
]

// ── 地图 SVG 贴图 ────────────────────────────────────────────
const TILE_SVGS: Record<string, string> = {
  '.': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect width="40" height="40" fill="#1c1c20"/>
    <rect width="20" height="20" fill="#1f1f26" opacity="0.7"/>
    <rect x="20" y="20" width="20" height="20" fill="#1f1f26" opacity="0.7"/>
    <line x1="0" y1="0" x2="40" y2="0" stroke="#26262c" stroke-width="0.6"/>
    <line x1="0" y1="0" x2="0" y2="40" stroke="#26262c" stroke-width="0.6"/>
  </svg>`,
  'x': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect width="40" height="40" fill="#3c3c4a"/>
    <rect x="1" y="1" width="38" height="18" fill="#4e4e60"/>
    <rect y="38" width="40" height="2" fill="#282834"/>
    <rect x="38" width="2" height="40" fill="#28283a"/>
    <polyline points="9,3 11,16 8,19" fill="none" stroke="#2a2a38" stroke-width="1.2" opacity="0.65"/>
    <polyline points="26,2 24,13 27,17" fill="none" stroke="#2a2a38" stroke-width="1" opacity="0.55"/>
    <line x1="16" y1="22" x2="14" y2="36" stroke="#2a2a38" stroke-width="1" opacity="0.5"/>
  </svg>`,
  'm': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect width="40" height="40" fill="#6b2c10"/>
    <ellipse cx="20" cy="22" rx="15" ry="12" fill="#9a4a25"/>
    <ellipse cx="17" cy="17" rx="8" ry="6" fill="#b56030" opacity="0.65"/>
    <ellipse cx="22" cy="28" rx="12" ry="5" fill="#4e1e06" opacity="0.6"/>
    <circle cx="13" cy="16" r="3" fill="#833a1a" opacity="0.75"/>
    <circle cx="28" cy="21" r="3.5" fill="#6a2e0e" opacity="0.7"/>
    <circle cx="20" cy="11" r="2.5" fill="#ac5030" opacity="0.55"/>
  </svg>`,
  'o': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect width="40" height="40" fill="#1e3d12"/>
    <rect width="20" height="20" fill="#162e0c" opacity="0.35"/>
    <rect x="20" y="20" width="20" height="20" fill="#162e0c" opacity="0.35"/>
    <circle cx="12" cy="27" r="2.5" fill="#0c1e07" opacity="0.7"/>
    <polygon points="12,27 9,16 15,16" fill="#52c228" opacity="0.93"/>
    <polygon points="12,27 3,22 7,28" fill="#3fa81c" opacity="0.93"/>
    <polygon points="12,27 16,16 20,22" fill="#62d836" opacity="0.93"/>
    <polygon points="12,27 5,28 6,20" fill="#48b822" opacity="0.88"/>
    <polygon points="12,27 19,28 18,20" fill="#3d9414" opacity="0.88"/>
    <polygon points="12,27 11,16 14,16" fill="#56b424" opacity="0.85"/>
    <circle cx="29" cy="13" r="2.2" fill="#0c1e07" opacity="0.7"/>
    <polygon points="29,13 26,3 32,3" fill="#4ab820" opacity="0.93"/>
    <polygon points="29,13 21,8 25,14" fill="#3d9414" opacity="0.93"/>
    <polygon points="29,13 33,3 37,8" fill="#5cc230" opacity="0.93"/>
    <polygon points="29,13 23,14 24,6" fill="#44a81a" opacity="0.88"/>
    <polygon points="29,13 36,14 35,6" fill="#3d9414" opacity="0.88"/>
  </svg>`,
}

// ── 子弹样式 ─────────────────────────────────────────────────
interface BulletStyleDef {
  color: number; radius: number; glowColor?: number; shape: 'circle' | 'diamond'
}
const DEFAULT_BULLET: BulletStyleDef = { color: 0xfef08a, radius: 4, shape: 'circle' }

function drawBullet(g: PIXI.Graphics, style: BulletStyleDef) {
  g.clear()
  if (style.glowColor !== undefined) {
    g.beginFill(style.glowColor, 0.35).drawCircle(0, 0, style.radius * 1.8).endFill()
  }
  const r = style.radius
  if (style.shape === 'diamond') {
    g.beginFill(style.color).drawPolygon([0, -r * 1.3, r, 0, 0, r * 1.3, -r, 0]).endFill()
  } else {
    g.beginFill(style.color).drawCircle(0, 0, r).endFill()
  }
}

// ── 工具函数 ──────────────────────────────────────────────────
function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function makeTileSprite(ch: string, px: number, py: number): PIXI.Sprite {
  const svg = TILE_SVGS[ch] ?? TILE_SVGS['.']
  const sp  = PIXI.Sprite.from(svgUrl(svg))
  sp.x = px; sp.y = py; sp.width = TS; sp.height = TS
  return sp
}

// ── HP 血量条组件 ─────────────────────────────────────────────
function HpBar({ hp, color }: { hp: number; color: string }) {
  const pct = Math.max(0, Math.min(1, hp / 100))
  return (
    <div
      className="relative h-3 w-full overflow-hidden rounded-full"
      style={{ background: "rgba(255,255,255,0.08)", border: `2px solid ${color}40` }}
    >
      <div
        className="h-full rounded-full transition-all duration-100"
        style={{
          width: `${pct * 100}%`,
          background: pct > 0.5 ? color : pct > 0.25 ? "#FFE600" : "#ef4444",
          boxShadow: `0 0 6px ${pct > 0.5 ? color : pct > 0.25 ? "#FFE600" : "#ef4444"}`,
        }}
      />
    </div>
  )
}

// ── PlayContent（单局游戏实例，key 变化时重新挂载）────────────
function PlayContent({ onRestart }: { onRestart: () => void }) {
  const router = useRouter()

  // React 状态（仅 UI 数据）
  const [status,  setStatus]  = useState<GameStatus>("connecting")
  const [tick,    setTick]    = useState(0)
  const [tanks,   setTanks]   = useState<TankSnapshot[]>([])
  const [endInfo, setEndInfo] = useState<{
    winner: string; winner_label: string; timed_out: boolean; total_ticks: number
  } | null>(null)

  // refs（不触发重渲染）
  const wsRef         = useRef<WebSocket | null>(null)
  const latestFrame   = useRef<FrameData | null>(null)
  const pixiApp       = useRef<PIXI.Application | null>(null)
  const canvasRef     = useRef<HTMLDivElement>(null)
  const pixiReady     = useRef(false)
  const statusRef     = useRef<GameStatus>("connecting")

  // 同步 status 到 ref（供 onKeyDown 使用，避免 closure 陈旧值）
  useEffect(() => { statusRef.current = status }, [status])

  // PixiJS sprite 映射
  type TankSprites = { root: PIXI.Container; body: PIXI.Container }
  const tankSprites  = useRef<Map<number, TankSprites>>(new Map())
  const bulletGraphs = useRef<PIXI.Graphics[]>([])
  const starSprites  = useRef<PIXI.Sprite[]>([])
  const bLayer       = useRef<PIXI.Container | null>(null)
  const sLayer       = useRef<PIXI.Container | null>(null)
  const tankLayer    = useRef<PIXI.Container | null>(null)

  // ── 初始化 PixiJS（收到 init 消息后调用）────────────────────
  const initPixi = useCallback((arenaData: ArenaInfo) => {
    const el = canvasRef.current
    if (!el || pixiReady.current) return
    pixiReady.current = true

    const app = new PIXI.Application({
      width: VIEW, height: VIEW,
      backgroundColor: 0x18181b,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    el.appendChild(app.view as HTMLCanvasElement)
    pixiApp.current = app

    // 地图层
    const mapC = new PIXI.Container()
    arenaData.map.forEach((row, r) =>
      row.split('').forEach((ch, c) => mapC.addChild(makeTileSprite(ch, c * TS, r * TS)))
    )
    app.stage.addChild(mapC)

    // 图层顺序：星星 → 子弹 → 坦克 → 草地覆盖
    const starLayer   = new PIXI.Container(); app.stage.addChild(starLayer);   sLayer.current = starLayer
    const bulletLayer = new PIXI.Container(); app.stage.addChild(bulletLayer); bLayer.current = bulletLayer
    const tLayer      = new PIXI.Container(); app.stage.addChild(tLayer);      tankLayer.current = tLayer

    // 草地覆盖层（在坦克上方，半透明遮住坦克）
    const grassOverlay = new PIXI.Container()
    grassOverlay.alpha = 0.62
    arenaData.map.forEach((row, r) =>
      row.split('').forEach((ch, c) => {
        if (ch === 'o') grassOverlay.addChild(makeTileSprite('o', c * TS, r * TS))
      })
    )
    app.stage.addChild(grassOverlay)

    // 边框
    const border = new PIXI.Graphics()
    border.lineStyle(1.5, 0x3b82f6).drawRect(0, 0, VIEW, VIEW)
    app.stage.addChild(border)

    // PixiJS Ticker：每帧读取最新帧数据，直接定位（无插值）
    app.ticker.add(() => {
      const frame = latestFrame.current
      if (!frame) return

      // 更新坦克（动态创建 sprite）
      frame.tanks.forEach(t => {
        let sp = tankSprites.current.get(t.id)
        if (!sp) {
          const tl = tankLayer.current
          if (!tl) return
          const root = new PIXI.Container()
          const body = new PIXI.Container()
          body.rotation = t.body_angle
          const pal = PALETTE[t.id % PALETTE.length]
          const g = new PIXI.Graphics()
          // 履带
          g.beginFill(pal.dark).drawRoundedRect(-TS * 0.4, -TS * 0.28, TS * 0.8, TS * 0.11, 2).endFill()
          g.beginFill(pal.dark).drawRoundedRect(-TS * 0.4,  TS * 0.17, TS * 0.8, TS * 0.11, 2).endFill()
          // 车体
          g.beginFill(pal.body).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3).endFill()
          // 炮管（body_angle=0 朝右，对应 East）
          g.beginFill(pal.dark).drawRoundedRect(TS * 0.05, -TS * 0.06, TS * 0.5, TS * 0.12, 2).endFill()
          body.addChild(g)
          body.scale.set(1.25)
          root.addChild(body)
          tl.addChild(root)
          sp = { root, body }
          tankSprites.current.set(t.id, sp)
        }
        sp.root.x = t.x * S
        sp.root.y = t.y * S
        sp.root.alpha = t.alive ? 1 : 0.15
        sp.body.rotation = t.body_angle
      })

      // 更新子弹
      const bl = bLayer.current
      if (bl) {
        while (bulletGraphs.current.length < frame.bullets.length) {
          const g = new PIXI.Graphics()
          drawBullet(g, DEFAULT_BULLET)
          bl.addChild(g)
          bulletGraphs.current.push(g)
        }
        bulletGraphs.current.forEach((g, i) => {
          const b = frame.bullets[i]
          if (!b) { g.visible = false; return }
          g.visible = true
          g.x = b.x * S
          g.y = b.y * S
        })
      }

      // 更新星星
      const sl = sLayer.current
      if (sl) {
        const ss = frame.stars ?? []
        while (starSprites.current.length < ss.length) {
          const sp = new PIXI.Sprite(PIXI.Texture.WHITE)
          sp.tint = 0xfbbf24; sp.width = sp.height = 26; sp.anchor.set(0.5)
          sl.addChild(sp); starSprites.current.push(sp)
        }
        starSprites.current.forEach((sp, i) => {
          const s = ss[i]
          if (!s) { sp.visible = false; return }
          sp.visible = true; sp.x = s.x * S; sp.y = s.y * S
        })
      }
    })
  }, [])

  // ── WebSocket 连接 ─────────────────────────────────────────
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002")
      .replace(/^https?/, "ws")
    const socket = new WebSocket(`${base}/api/play`)
    wsRef.current = socket

    socket.onmessage = (event) => {
      let msg: unknown
      try { msg = JSON.parse(event.data as string) } catch { return }
      if (typeof msg !== 'object' || msg === null) return
      const m = msg as Record<string, unknown>

      if (m.type === 'init') {
        setStatus("playing")
        // 等待 DOM 渲染完毕后初始化 PixiJS
        setTimeout(() => initPixi(m.arena as ArenaInfo), 0)
      } else if (m.type === 'frame') {
        const f = m as unknown as FrameData & { type: string }
        latestFrame.current = {
          tick: f.tick,
          tanks: f.tanks,
          bullets: f.bullets,
          stars: f.stars,
        }
        // 同步 UI 状态（每帧只更新 tick 和坦克数据）
        setTick(f.tick)
        setTanks(f.tanks)
      } else if (m.type === 'end') {
        setEndInfo({
          winner:       String(m.winner ?? ""),
          winner_label: String(m.winner_label ?? m.winner ?? ""),
          timed_out:    Boolean(m.timed_out),
          total_ticks:  Number(m.total_ticks ?? 0),
        })
        setStatus("ended")
      }
    }

    socket.onerror = () => {
      setStatus("disconnected")
    }

    socket.onclose = () => {
      // 仅在 playing 时才切换到 disconnected，ended 时保留 ended 状态
      setStatus(prev => prev === "playing" ? "disconnected" : prev)
    }

    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const spritesMap = tankSprites.current
      socket.close()
      wsRef.current = null
      // 销毁 PixiJS 实例
      if (pixiApp.current) {
        pixiApp.current.destroy(true, { children: true })
        pixiApp.current = null
      }
      pixiReady.current = false
      spritesMap.clear()
      bulletGraphs.current = []
      starSprites.current = []
      bLayer.current = null
      sLayer.current = null
      tankLayer.current = null
      latestFrame.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 键盘控制 ──────────────────────────────────────────────
  useEffect(() => {
    // WASD = 绝对方向（north/west/south/east），按键时自动计算转向 + 前进
    // 0=north 1=east 2=south 3=west
    const KEY_FACING: Record<string, number> = {
      ArrowUp: 0, w: 0, W: 0,
      ArrowDown: 2, s: 2, S: 2,
      ArrowLeft: 3, a: 3, A: 3,
      ArrowRight: 1, d: 1, D: 1,
    }

    function angleToFacing(angle: number): number {
      // body_angle: East=0, South=π/2, West=π or -π, North=-π/2
      const PI = Math.PI
      if (Math.abs(angle) < 0.1)              return 1  // east
      if (Math.abs(angle - PI / 2) < 0.1)    return 2  // south
      if (Math.abs(Math.abs(angle) - PI) < 0.1) return 3  // west (±π)
      return 0                                           // north (-π/2)
    }

    function sendAll(cmds: string[]) {
      const ws = wsRef.current
      if (!ws) return
      for (const cmd of cmds) ws.send(JSON.stringify({ cmd }))
    }

    function onKeyDown(e: KeyboardEvent) {
      if (statusRef.current !== 'playing') return
      if (e.key === ' ') {
        e.preventDefault()
        wsRef.current?.send(JSON.stringify({ cmd: 'fire' }))
        return
      }
      const tgt = KEY_FACING[e.key]
      if (tgt === undefined) return
      e.preventDefault()
      const player = latestFrame.current?.tanks.find(t => t.id === 0)
      const cur = player ? angleToFacing(player.body_angle) : -1
      if (cur === -1) { sendAll(['move']); return }
      const diff = (tgt - cur + 4) % 4
      if      (diff === 0) sendAll(['move'])
      else if (diff === 1) sendAll(['turnRight', 'move'])
      else if (diff === 3) sendAll(['turnLeft', 'move'])
      else                 sendAll(['turnRight', 'turnRight', 'move'])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── 渲染逻辑 ─────────────────────────────────────────────
  const player = tanks.find(t => t.id === 0)
  const enemy  = tanks.find(t => t.id !== 0)

  // 结束遮罩的颜色和文字
  let overlayColor = "#FFE600"
  let overlayTitle = "游戏结束"
  let overlayIcon  = "⏰"
  if (endInfo) {
    // 判断玩家是否获胜：winner 字段与玩家的 name 比较
    const playerName = player?.name ?? ""
    const playerWon  = endInfo.winner === playerName
      || endInfo.winner_label === playerName
      || endInfo.winner === "player"
    if (playerWon) {
      overlayColor = "#00F5D4"; overlayTitle = "胜利！"; overlayIcon = "🏆"
    } else if (endInfo.timed_out) {
      overlayColor = "#FFE600"; overlayTitle = "超时！"; overlayIcon = "⏰"
    } else {
      overlayColor = "#ef4444"; overlayTitle = "战败！"; overlayIcon = "💀"
    }
  }

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-6">

      {/* 背景纹理 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.07]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      <div className="relative mx-auto w-full max-w-[920px] flex flex-col gap-5">

        {/* ── 顶部栏 ── */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 rounded-full border-4 border-dashed border-[#7B2FFF] px-4 py-1.5 text-sm font-black uppercase tracking-widest text-[#7B2FFF] transition-all duration-150 hover:bg-[#7B2FFF]/10 hover:scale-105"
          >
            <ArrowLeft className="size-4" /> 返回
          </button>

          <h1
            className="text-2xl font-black uppercase tracking-widest text-white"
            style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #7B2FFF, 4px 4px 0 #FF3AF2" }}
          >
            亲自上阵
          </h1>

          <div
            className="flex items-center gap-2 rounded-full border-4 px-4 py-1.5"
            style={{
              borderColor: "#FF3AF2",
              background: "rgba(255,58,242,0.12)",
              boxShadow: "0 0 12px rgba(255,58,242,0.4)",
            }}
          >
            <span
              className={`size-2 rounded-full ${status === 'playing' ? 'animate-pulse bg-[#00F5D4]' : 'bg-[#FF3AF2]'}`}
            />
            <span className="font-mono text-xs font-black uppercase tracking-[0.3em] text-[#FF3AF2]">
              回合 {tick}
            </span>
          </div>
        </div>

        {/* ── 主内容区 ── */}
        <div className="flex gap-5 items-start">

          {/* 画布列 */}
          <div className="relative flex-shrink-0">
            {/* 画布外框（Maximalism 风格）*/}
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                border: "4px solid #FF3AF2",
                boxShadow: "8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF",
              }}
            >
              <div
                ref={canvasRef}
                style={{ width: VIEW, height: VIEW, background: "#18181b" }}
              />
            </div>

            {/* 状态覆盖层 */}
            {status !== 'playing' && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl"
                style={{ background: "rgba(13,13,26,0.88)", zIndex: 10 }}
              >
                {status === 'connecting' && (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="size-10 animate-spin text-[#FF3AF2]" />
                    <p className="text-sm font-black uppercase tracking-[0.3em] text-[#FF3AF2]">
                      正在连接…
                    </p>
                  </div>
                )}

                {status === 'disconnected' && (
                  <div className="flex flex-col items-center gap-4 text-center px-8">
                    <span className="text-4xl">⚡</span>
                    <p
                      className="text-2xl font-black uppercase tracking-widest"
                      style={{ color: "#FF6B35", textShadow: "2px 2px 0 #FF3AF2" }}
                    >
                      连接断开
                    </p>
                    <p className="text-xs font-bold text-white/40">无法连接到后端服务 (ws://localhost:3002)</p>
                    <button
                      onClick={onRestart}
                      className="mt-2 rounded-full border-4 border-[#FF6B35] px-6 py-2 text-sm font-black uppercase tracking-widest text-[#FF6B35] transition-all hover:bg-[#FF6B35]/15 hover:scale-105"
                      style={{ boxShadow: "3px 3px 0 #7B2FFF" }}
                    >
                      重新连接
                    </button>
                  </div>
                )}

                {status === 'ended' && endInfo && (
                  <div className="flex flex-col items-center gap-4 px-8 text-center">
                    <span className="text-5xl">{overlayIcon}</span>
                    <p
                      className="text-3xl font-black uppercase tracking-widest"
                      style={{ color: overlayColor, textShadow: "3px 3px 0 #7B2FFF" }}
                    >
                      {overlayTitle}
                    </p>
                    {endInfo.timed_out && (
                      <p className="text-sm font-bold text-white/50">
                        胜者：{endInfo.winner_label || endInfo.winner || "平局"}
                      </p>
                    )}
                    <p className="text-xs font-bold text-white/40">
                      共 {endInfo.total_ticks} 回合
                    </p>
                    <button
                      onClick={onRestart}
                      className="mt-2 rounded-full border-4 px-8 py-2.5 text-sm font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                      style={{
                        borderColor: overlayColor,
                        background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                        boxShadow: `3px 3px 0 ${overlayColor}`,
                        color: "white",
                      }}
                    >
                      再来一局
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右侧状态面板 */}
          <div className="flex w-56 shrink-0 flex-col gap-3">

            {/* 玩家信息 */}
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                border: "4px solid #3b82f6",
                background: "rgba(45,27,78,0.5)",
                boxShadow: "4px 4px 0 rgba(59,130,246,0.3)",
              }}
            >
              <div
                className="px-4 py-2.5 flex items-center gap-2"
                style={{ borderBottom: "4px dashed rgba(59,130,246,0.4)", background: "rgba(13,13,26,0.4)" }}
              >
                <span className="size-2.5 rounded-full bg-[#3b82f6]" style={{ boxShadow: "0 0 6px #3b82f6" }} />
                <p className="text-xs font-black uppercase tracking-widest text-[#3b82f6]">
                  {player?.name ?? "玩家"}
                </p>
              </div>
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">HP</span>
                  <span className="text-sm font-black text-white tabular-nums">
                    {player?.hp ?? 100}
                  </span>
                </div>
                <HpBar hp={player?.hp ?? 100} color="#3b82f6" />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">分数</span>
                  <span
                    className="text-sm font-black tabular-nums"
                    style={{ color: "#FFE600", textShadow: "0 0 8px rgba(255,230,0,0.5)" }}
                  >
                    {player?.score ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* AI 对手信息 */}
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                border: "4px solid #ef4444",
                background: "rgba(45,27,78,0.5)",
                boxShadow: "4px 4px 0 rgba(239,68,68,0.3)",
              }}
            >
              <div
                className="px-4 py-2.5 flex items-center gap-2"
                style={{ borderBottom: "4px dashed rgba(239,68,68,0.4)", background: "rgba(13,13,26,0.4)" }}
              >
                <span className="size-2.5 rounded-full bg-[#ef4444]" style={{ boxShadow: "0 0 6px #ef4444" }} />
                <p className="text-xs font-black uppercase tracking-widest text-[#ef4444]">
                  {enemy?.name ?? "AI 对手"}
                </p>
              </div>
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">HP</span>
                  <span className="text-sm font-black text-white tabular-nums">
                    {enemy?.hp ?? 100}
                  </span>
                </div>
                <HpBar hp={enemy?.hp ?? 100} color="#ef4444" />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">分数</span>
                  <span
                    className="text-sm font-black tabular-nums"
                    style={{ color: "#FFE600", textShadow: "0 0 8px rgba(255,230,0,0.5)" }}
                  >
                    {enemy?.score ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* 分割线 */}
            <div
              className="h-px w-full"
              style={{ background: "linear-gradient(90deg, transparent, #7B2FFF55, transparent)" }}
            />

            {/* 操作说明 */}
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                border: "4px solid #7B2FFF",
                background: "rgba(45,27,78,0.5)",
                boxShadow: "4px 4px 0 rgba(123,47,255,0.3)",
              }}
            >
              <div
                className="px-4 py-2.5"
                style={{ borderBottom: "4px dashed rgba(123,47,255,0.4)", background: "rgba(13,13,26,0.4)" }}
              >
                <p className="text-xs font-black uppercase tracking-widest text-[#7B2FFF]">操作说明</p>
              </div>
              <div className="px-4 py-3 flex flex-col gap-2">
                {[
                  { keys: "↑ / W",  action: "前进" },
                  { keys: "← / A",  action: "左转" },
                  { keys: "→ / D",  action: "右转" },
                  { keys: "空格",    action: "开火" },
                ].map(({ keys, action }) => (
                  <div key={action} className="flex items-center justify-between">
                    <kbd
                      className="rounded px-2 py-0.5 text-[10px] font-black"
                      style={{
                        background: "rgba(123,47,255,0.25)",
                        border: "2px solid rgba(123,47,255,0.4)",
                        color: "#a78bfa",
                      }}
                    >
                      {keys}
                    </kbd>
                    <span className="text-[11px] font-bold text-white/50">{action}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 连接状态指示器 */}
            <div
              className="rounded-2xl px-4 py-2.5 flex items-center gap-2"
              style={{
                border: `4px solid ${
                  status === 'playing'      ? '#00F5D4'
                  : status === 'ended'      ? '#FFE600'
                  : status === 'connecting' ? '#FF3AF2'
                  :                           '#4b5563'
                }`,
                background: "rgba(13,13,26,0.6)",
              }}
            >
              <span
                className={`size-2 rounded-full ${status === 'playing' ? 'animate-pulse' : ''}`}
                style={{
                  background: status === 'playing'      ? '#00F5D4'
                             : status === 'ended'        ? '#FFE600'
                             : status === 'connecting'   ? '#FF3AF2'
                             :                             '#4b5563',
                }}
              />
              <span
                className="text-[10px] font-black uppercase tracking-[0.2em]"
                style={{
                  color: status === 'playing'      ? '#00F5D4'
                       : status === 'ended'        ? '#FFE600'
                       : status === 'connecting'   ? '#FF3AF2'
                       :                             '#4b5563',
                }}
              >
                {status === 'connecting'  ? '连接中'
                  : status === 'playing'  ? '对战中'
                  : status === 'ended'    ? '已结束'
                  :                         '已断开'}
              </span>
            </div>

          </div>
        </div>
      </div>
    </main>
  )
}

// ── 主页面（包装层，通过 key 强制重新挂载实现"再来一局"）──────
export default function PlayPage() {
  const [gameKey, setGameKey] = useState(0)
  return (
    <PlayContent
      key={gameKey}
      onRestart={() => setGameKey(k => k + 1)}
    />
  )
}
