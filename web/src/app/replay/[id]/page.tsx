"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Play, Pause, SkipBack, ArrowLeft, Volume2, VolumeX } from "lucide-react"
import * as PIXI from "pixi.js"

// ── 数据类型 ──────────────────────────────────────────────────
interface TankSnapshot {
  id: number; name: string; x: number; y: number
  body_angle: number; hp: number; alive: boolean; score: number
}
interface BulletSnapshot { id: number; x: number; y: number; owner_id: number }
interface StarSnapshot   { x: number; y: number }
interface FrameData {
  tick: number
  tanks: TankSnapshot[]
  bullets: BulletSnapshot[]
  stars: StarSnapshot[]
}
interface JsExecStats {
  tank_name: string
  idle_calls: number
  empty_calls: number
  total_exec_us: number
  max_exec_us: number
  avg_exec_us: number
  error_count: number
  commands_issued: number
  peak_memory_bytes: number
}
interface BattleResult {
  winner: string; winner_label?: string; total_ticks: number; timed_out?: boolean
  arena: { map: string[] }
  telemetry: FrameData[]
  battle_log: string[]
  skins?: Record<string, { svg?: string; bullet_style?: string }>
  js_stats?: JsExecStats[]
}

// ── 子弹皮肤样式 ─────────────────────────────────────────────────
interface BulletStyleDef { color: number; radius: number; glowColor?: number; shape: 'circle' | 'diamond' | 'star' }
const BULLET_STYLE_DEFS: Record<string, BulletStyleDef> = {
  default: { color: 0xfef08a, radius: 4,   shape: 'circle' },
  fire:    { color: 0xff5500, radius: 5,   shape: 'circle',  glowColor: 0xff2200 },
  plasma:  { color: 0x22d3ee, radius: 4.5, shape: 'circle',  glowColor: 0x0891b2 },
  void:    { color: 0xa855f7, radius: 5,   shape: 'diamond', glowColor: 0x6d28d9 },
  gold:    { color: 0xfbbf24, radius: 5,   shape: 'star' },
}

function drawBullet(g: PIXI.Graphics, style: BulletStyleDef) {
  g.clear()
  if (style.glowColor !== undefined) {
    g.beginFill(style.glowColor, 0.35).drawCircle(0, 0, style.radius * 1.8).endFill()
  }
  const r = style.radius
  if (style.shape === 'diamond') {
    g.beginFill(style.color).drawPolygon([0, -r * 1.3, r, 0, 0, r * 1.3, -r, 0]).endFill()
  } else if (style.shape === 'star') {
    const pts: number[] = []
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2
      const rad = i % 2 === 0 ? r : r * 0.45
      pts.push(Math.cos(angle) * rad, Math.sin(angle) * rad)
    }
    g.beginFill(style.color).drawPolygon(pts).endFill()
  } else {
    g.beginFill(style.color).drawCircle(0, 0, r).endFill()
  }
}

// ── 背景音乐（Web Audio API chiptune）────────────────────────
const _NOTE: Record<string, number> = {
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
}
// 欢乐颂主题循环 [Hz, 拍数]
const _MELODY: [number, number][] = [
  [_NOTE.E5,.5],[_NOTE.E5,.5],[_NOTE.F5,.5],[_NOTE.G5,.5],
  [_NOTE.G5,.5],[_NOTE.F5,.5],[_NOTE.E5,.5],[_NOTE.D5,.5],
  [_NOTE.C5,.5],[_NOTE.C5,.5],[_NOTE.D5,.5],[_NOTE.E5,.5],
  [_NOTE.E5,.75],[_NOTE.D5,.25],[_NOTE.D5,1],
  [_NOTE.E5,.5],[_NOTE.E5,.5],[_NOTE.F5,.5],[_NOTE.G5,.5],
  [_NOTE.G5,.5],[_NOTE.F5,.5],[_NOTE.E5,.5],[_NOTE.D5,.5],
  [_NOTE.C5,.5],[_NOTE.C5,.5],[_NOTE.D5,.5],[_NOTE.E5,.5],
  [_NOTE.D5,.75],[_NOTE.C5,.25],[_NOTE.C5,1],
]
const _BEAT = 60 / 120  // 120 BPM

function useBGM(active: boolean) {
  const ctx   = useRef<AudioContext | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const st    = useRef({ idx: 0, next: 0 })

  function scheduleNote(freq: number, t: number, dur: number) {
    const c = ctx.current!
    const osc = c.createOscillator()
    const g   = c.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.07, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.82)
    osc.connect(g); g.connect(c.destination)
    osc.start(t); osc.stop(t + dur)
  }

  function pump() {
    const c = ctx.current!
    const now = c.currentTime
    while (st.current.next < now + 0.12) {
      const [freq, beats] = _MELODY[st.current.idx]
      const dur = beats * _BEAT
      const t = Math.max(st.current.next, now)
      scheduleNote(freq, t, dur)
      st.current.next = t + dur
      st.current.idx  = (st.current.idx + 1) % _MELODY.length
    }
    timer.current = setTimeout(pump, 50)
  }

  useEffect(() => {
    if (active) {
      if (!ctx.current) ctx.current = new AudioContext()
      ctx.current.resume().then(() => {
        if (!timer.current) {
          st.current = { idx: 0, next: ctx.current!.currentTime }
          pump()
        }
      })
    } else {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      ctx.current?.suspend()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    ctx.current?.close()
  }, [])
}

// ── 常量 ──────────────────────────────────────────────────────
const WORLD  = 800
const TILE   = 40
const VIEW   = 560
const S      = VIEW / WORLD   // 0.7
const TS     = TILE * S       // 28px on screen
const MS_PER_TICK = 150

const PALETTE = [
  { body: 0x3b82f6, dark: 0x1e3a8a },
  { body: 0xef4444, dark: 0x7f1d1d },
  { body: 0x22c55e, dark: 0x14532d },
  { body: 0xa78bfa, dark: 0x4c1d95 },
]

// ── 工具函数 ──────────────────────────────────────────────────
function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// 按稳定 ID 匹配子弹，找不到则为 null（新出现的子弹）
function matchBullets(prev: BulletSnapshot[], curr: BulletSnapshot[]): (BulletSnapshot | null)[] {
  const prevById = new Map(prev.map(b => [b.id, b]))
  return curr.map(b => prevById.get(b.id) ?? null)
}

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

function makeTileSprite(ch: string, px: number, py: number): PIXI.Sprite {
  const svg = TILE_SVGS[ch] ?? TILE_SVGS['.']
  const sp  = PIXI.Sprite.from(svgUrl(svg))
  sp.x = px; sp.y = py; sp.width = TS; sp.height = TS
  return sp
}

// ── PixiView ──────────────────────────────────────────────────
interface PixiViewProps {
  data: BattleResult
  playing: boolean
  seekFn: React.MutableRefObject<((idx: number) => void) | null>
  onTick: (idx: number) => void
  onEnd: () => void
}

function PixiView({ data, playing, seekFn, onTick, onEnd }: PixiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // ── 坦克 sprite 映射 ──────────────────────────────────────
  type TankSprites = { root: PIXI.Container; body: PIXI.Container }
  const tanks        = useRef<Map<number, TankSprites>>(new Map())
  const bullets      = useRef<PIXI.Graphics[]>([])
  const bulletStyles = useRef<string[]>([])   // 每个 bullet graphic 当前已绘制的样式 key
  const stars        = useRef<PIXI.Sprite[]>([])
  const bLayer       = useRef<PIXI.Container | null>(null)
  const sLayer       = useRef<PIXI.Container | null>(null)

  // owner_id → BulletStyleDef，从 skins 构建
  const ownerStyleMap = useRef<Map<number, BulletStyleDef>>(new Map())
  useEffect(() => {
    const m = new Map<number, BulletStyleDef>()
    data.telemetry[0]?.tanks.forEach(t => {
      const styleName = data.skins?.[t.name]?.bullet_style ?? 'default'
      m.set(t.id, BULLET_STYLE_DEFS[styleName] ?? BULLET_STYLE_DEFS.default)
    })
    ownerStyleMap.current = m
  }, [data])

  // ── 插值状态（全 ref，零 React 延迟）──────────────────────
  const prev     = useRef<FrameData | null>(null)
  const curr     = useRef<FrameData | null>(null)
  const bMatches = useRef<(BulletSnapshot | null)[]>([])
  const idx      = useRef(0)
  const accum    = useRef(MS_PER_TICK)   // 初始 = MS_PER_TICK → 第一帧立即显示
  const lastMs   = useRef(0)             // performance.now() 参考点
  const playing_ = useRef(playing)
  const seekPend = useRef<number | null>(null)

  useEffect(() => { playing_.current = playing }, [playing])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // ── 初始化 Pixi ──────────────────────────────────────
    const app = new PIXI.Application({
      width: VIEW, height: VIEW,
      backgroundColor: 0x18181b,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    el.appendChild(app.view as HTMLCanvasElement)

    // ── 地图（SVG Sprite 贴图）───────────────────────────
    const mapC = new PIXI.Container()
    data.arena.map.forEach((row, r) =>
      row.split('').forEach((ch, c) => mapC.addChild(makeTileSprite(ch, c * TS, r * TS)))
    )
    app.stage.addChild(mapC)

    // ── 图层 ────────────────────────────────────────────
    const starLayer   = new PIXI.Container(); app.stage.addChild(starLayer);   sLayer.current = starLayer
    const bulletLayer = new PIXI.Container(); app.stage.addChild(bulletLayer); bLayer.current = bulletLayer
    const tankLayer   = new PIXI.Container(); app.stage.addChild(tankLayer)

    // 草地覆盖层（在坦克层上方，草叶半透明遮住坦克）
    const grassOverlay = new PIXI.Container()
    grassOverlay.alpha = 0.62
    data.arena.map.forEach((row, r) =>
      row.split('').forEach((ch, c) => {
        if (ch === 'o') grassOverlay.addChild(makeTileSprite('o', c * TS, r * TS))
      })
    )
    app.stage.addChild(grassOverlay)

    // ── 坦克容器 ─────────────────────────────────────────
    data.telemetry[0]?.tanks.forEach(t => {
      const root = new PIXI.Container()
      root.x = t.x * S; root.y = t.y * S

      const body = new PIXI.Container()
      body.rotation = t.body_angle

      const skin = data.skins?.[t.name]
      if (skin?.svg) {
        const sp = PIXI.Sprite.from(svgUrl(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -14 40 28">${skin.svg}</svg>`
        ))
        sp.width = TS; sp.height = TS * 0.7; sp.anchor.set(0.5)
        body.addChild(sp)
      } else {
        const pal = PALETTE[t.id % PALETTE.length]
        const g = new PIXI.Graphics()
        // 履带
        g.beginFill(pal.dark).drawRoundedRect(-TS * 0.4, -TS * 0.28, TS * 0.8, TS * 0.11, 2).endFill()
        g.beginFill(pal.dark).drawRoundedRect(-TS * 0.4,  TS * 0.17, TS * 0.8, TS * 0.11, 2).endFill()
        // 车体
        g.beginFill(pal.body).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3).endFill()
        // 炮管（朝右 = body_angle=0 对应 East）
        g.beginFill(pal.dark).drawRoundedRect(TS * 0.05, -TS * 0.06, TS * 0.5, TS * 0.12, 2).endFill()
        body.addChild(g)
      }

      root.addChild(body)
      tankLayer.addChild(root)
      tanks.current.set(t.id, { root, body })
    })

    // 边框
    const border = new PIXI.Graphics()
    border.lineStyle(1.5, 0x3b82f6).drawRect(0, 0, VIEW, VIEW)
    app.stage.addChild(border)

    // ── 初始状态 ─────────────────────────────────────────
    curr.current = data.telemetry[0] ?? null
    prev.current = null; bMatches.current = []; idx.current = 0
    accum.current = MS_PER_TICK; lastMs.current = performance.now()

    // 暴露 seek 给父组件
    seekFn.current = (i: number) => {
      seekPend.current = Math.max(0, Math.min(i, data.telemetry.length - 1))
    }

    // ── Ticker：帧推进 + 插值，全部在 GPU 循环内 ──────────
    app.ticker.add(() => {
      const now = performance.now()
      const dt  = now - lastMs.current   // 真实帧间距（ms）
      lastMs.current = now

      // 1. seek
      if (seekPend.current !== null) {
        const si = seekPend.current; seekPend.current = null
        idx.current  = si
        prev.current = si > 0 ? data.telemetry[si - 1] : null
        curr.current = data.telemetry[si] ?? null
        bMatches.current = matchBullets(prev.current?.bullets ?? [], curr.current?.bullets ?? [])
        accum.current = MS_PER_TICK   // 立即定位到目标帧，alpha=1
        return                         // 本帧跳过推进，下帧再开始
      }

      // 2. 帧推进（playing 时累积真实时间）
      if (playing_.current && dt < 500) {   // 忽略 >500ms 的大 delta（标签切走）
        accum.current += dt
        while (accum.current >= MS_PER_TICK) {
          const next = idx.current + 1
          if (next < data.telemetry.length) {
            prev.current    = curr.current
            curr.current    = data.telemetry[next]
            idx.current     = next
            accum.current  -= MS_PER_TICK
            bMatches.current = matchBullets(prev.current?.bullets ?? [], curr.current?.bullets ?? [])
            onTick(next)
          } else {
            accum.current  = MS_PER_TICK
            playing_.current = false
            onEnd()
            break
          }
        }
      }

      // 3. 插值渲染
      const c = curr.current
      const p = prev.current
      if (!c) return

      const alpha = Math.min(1, Math.max(0, accum.current / MS_PER_TICK))

      // 坦克
      c.tanks.forEach(t => {
        const sp = tanks.current.get(t.id); if (!sp) return
        const pt = p?.tanks.find(x => x.id === t.id)

        const fx = pt ? pt.x * S : t.x * S
        const fy = pt ? pt.y * S : t.y * S
        sp.root.x = fx + (t.x * S - fx) * alpha
        sp.root.y = fy + (t.y * S - fy) * alpha
        // 草地里的坦克由上方覆盖层遮挡，本体保持正常 alpha
        sp.root.alpha = t.alive ? 1 : 0.15

        // 角度插值（处理 ±π 跳变）
        const fa = pt ? pt.body_angle : t.body_angle
        let da = t.body_angle - fa
        if (da >  Math.PI) da -= Math.PI * 2
        if (da < -Math.PI) da += Math.PI * 2
        sp.body.rotation = fa + da * alpha
      })

      // 子弹
      const bl = bLayer.current
      if (bl) {
        while (bullets.current.length < c.bullets.length) {
          const g = new PIXI.Graphics()
          bl.addChild(g)
          bullets.current.push(g)
          bulletStyles.current.push('')
        }
        bullets.current.forEach((g, i) => {
          const b = c.bullets[i]
          if (!b) { g.visible = false; return }
          g.visible = true

          // 只在样式变化时重绘（避免每帧 clear/draw）
          const styleDef = ownerStyleMap.current.get(b.owner_id) ?? BULLET_STYLE_DEFS.default
          const styleKey = data.skins?.[data.telemetry[0]?.tanks.find(t => t.id === b.owner_id)?.name ?? '']?.bullet_style ?? 'default'
          if (bulletStyles.current[i] !== styleKey) {
            bulletStyles.current[i] = styleKey
            drawBullet(g, styleDef)
          }

          const pb = bMatches.current[i]
          const fx = pb ? pb.x * S : b.x * S
          const fy = pb ? pb.y * S : b.y * S
          g.x = fx + (b.x * S - fx) * alpha
          g.y = fy + (b.y * S - fy) * alpha
        })
      }

      // 星星
      const sl = sLayer.current
      if (sl) {
        const ss = c.stars ?? []
        while (stars.current.length < ss.length) {
          const sp = new PIXI.Sprite(PIXI.Texture.WHITE)
          sp.tint = 0xfbbf24; sp.width = sp.height = 14; sp.anchor.set(0.5)
          sl.addChild(sp); stars.current.push(sp)
        }
        stars.current.forEach((sp, i) => {
          const s = ss[i]
          if (!s) { sp.visible = false; return }
          sp.visible = true; sp.x = s.x * S; sp.y = s.y * S
        })
      }
    })

    return () => {
      seekFn.current = null
      app.destroy(true, { children: true })
      tanks.current.clear()
      bullets.current = []; stars.current = []
      bLayer.current = null; sLayer.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  return (
    <div ref={containerRef}
      className="rounded-xl overflow-hidden"
      style={{ width: VIEW, height: VIEW }} />
  )
}

// ── 主页面 ────────────────────────────────────────────────────
export default function ReplayPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [data,     setData]     = useState<BattleResult | null>(null)
  const [err,      setErr]      = useState<string | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing,  setPlaying]  = useState(false)
  const [bgm,      setBgm]      = useState(true)
  const [loadedAt]              = useState(() => new Date())

  const seekFn = useRef<((idx: number) => void) | null>(null)

  useBGM(playing && bgm)

  useEffect(() => {
    if (!id) return
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"
    fetch(`${base}/api/replay/${id}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: BattleResult) => { setData(d); setPlaying(true) })
      .catch(e => setErr(e instanceof Error ? e.message : "加载失败"))
  }, [id])

  function handlePlayPause() {
    if (!data) return
    if (frameIdx >= data.telemetry.length - 1) { seekFn.current?.(0); setFrameIdx(0) }
    setPlaying(p => !p)
  }
  function handleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const i = Number(e.target.value)
    setFrameIdx(i); seekFn.current?.(i); setPlaying(false)
  }
  function handleReset() {
    setPlaying(false); seekFn.current?.(0); setFrameIdx(0)
  }

  const total  = data?.telemetry.length ?? 0
  const frame0 = data?.telemetry[0]
  const t0 = frame0?.tanks[0]
  const t1 = frame0?.tanks[1]
  const result = data ? (data.timed_out ? "超时" : "击败") : "—"

  if (err) return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950">
      <p className="text-red-400">加载失败：{err}</p>
    </main>
  )
  if (!data) return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
        <p className="text-sm text-zinc-500">载入中…</p>
      </div>
    </main>
  )

  function TankIcon({ name, color, border: borderColor }: { name: string; color: string; border: string }) {
    const skin = data!.skins?.[name]
    return (
      <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl border-2 overflow-hidden`}
        style={{ borderColor, background: `${color}22` }}>
        {skin?.svg
          ? <svg viewBox="-20 -14 40 28" width="44" height="31" dangerouslySetInnerHTML={{ __html: skin.svg }} />
          : <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="6" width="16" height="8" rx="2" fill={color} />
              <rect x="8" y="2" width="5" height="7" rx="1" fill={color} opacity=".7" />
              <circle cx="5"  cy="15" r="2" fill={color} opacity=".6" />
              <circle cx="15" cy="15" r="2" fill={color} opacity=".6" />
            </svg>
        }
      </div>
    )
  }

  return (
    <main className="flex flex-1 flex-col bg-zinc-950">
      <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col gap-4 px-4 py-5">

        {/* 顶栏 */}
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors">
            <ArrowLeft className="size-4" /> 返回
          </button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-red-500">
            <span className="size-2 rounded-sm bg-red-500" /> 回放
          </span>
        </div>

        {/* 赛况 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t0?.name ?? "—"} vs {t1?.name ?? "—"}</h1>
            <p className="mt-1 text-sm text-zinc-500">{result} · {loadedAt.toLocaleString()}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            {([["胜者", (data.winner_label ?? data.winner) || "—", "text-blue-400"], ["结果", result, "text-white"], ["帧数", String(data.total_ticks), "text-white"]] as const).map(([l, v, c]) => (
              <div key={l} className="min-w-[80px] rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-3">
                <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">{l}</p>
                <p className={`mt-1 text-sm font-semibold ${c}`}>{v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 对阵栏 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="flex items-stretch">
            <div className="flex flex-1 items-center gap-4 px-5 py-4">
              <TankIcon name={t0?.name ?? ""} color="#3b82f6" border="#2563eb" />
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t0?.name ?? "—"}</p>
                {data.winner === t0?.name && <span className="mt-1 inline-block rounded bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">胜者</span>}
              </div>
            </div>
            <div className="flex items-center justify-center border-x border-zinc-800 px-5">
              <span className="text-sm font-bold text-zinc-500">VS</span>
            </div>
            <div className="flex flex-1 items-center justify-end gap-4 px-5 py-4">
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t1?.name ?? "—"}</p>
                {data.winner === t1?.name && <span className="mt-1 inline-block rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">胜者</span>}
              </div>
              <TankIcon name={t1?.name ?? ""} color="#ef4444" border="#dc2626" />
            </div>
          </div>
        </div>

        {/* 主体 */}
        <div className="flex flex-1 gap-4">

          {/* 画布区 */}
          <div className="flex flex-1 flex-col gap-3 min-w-0 items-center">
            <div className="flex items-center gap-2 w-full max-w-[560px]">
              <button onClick={handleReset}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
                <SkipBack className="size-3.5" />
              </button>
              <button onClick={handlePlayPause}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors">
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <input type="range" min={0} max={Math.max(0, total - 1)} value={frameIdx}
                onChange={handleSlider} className="flex-1 accent-blue-500" />
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                {frameIdx + 1} / {total}
              </span>
              <button onClick={() => setBgm(b => !b)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
                title={bgm ? "静音" : "开启音乐"}>
                {bgm ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              </button>
            </div>

            <PixiView
              data={data} playing={playing}
              seekFn={seekFn}
              onTick={setFrameIdx}
              onEnd={() => setPlaying(false)}
            />
          </div>

          {/* 右侧面板 */}
          <div className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shrink-0">
              <p className="mb-3 text-xs font-bold tracking-widest text-zinc-500 uppercase">坦克状态</p>
              {data.telemetry[frameIdx]?.tanks.map((t, i) => {
                const col = i === 0 ? "#3b82f6" : "#ef4444"
                return (
                  <div key={t.id} className="flex items-center justify-between py-1.5 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: col }} />
                      <span className="text-sm font-semibold text-white">{t.name}</span>
                    </div>
                    <span className={`text-xs font-medium ${t.alive ? "text-green-400" : "text-zinc-500"}`}>
                      {t.alive ? "存活" : "已摧毁"}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* JS 执行统计 —— 固定高度，始终可见 */}
            {data.js_stats && data.js_stats.length > 0 && (() => {
              function fmtUs(us: number): string {
                if (us < 1000) return `${us.toFixed(1)} µs`
                return `${(us / 1000).toFixed(2)} ms`
              }
              function fmtMem(bytes: number): string {
                if (bytes < 1024) return `${bytes} B`
                if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
                return `${(bytes / 1024 / 1024).toFixed(2)} MB`
              }
              return (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden shrink-0">
                  <div className="border-b border-zinc-800 px-4 py-2.5">
                    <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">JS 执行统计</p>
                  </div>
                  <div className="flex flex-col divide-y divide-zinc-800">
                    {(() => {
                      const stats = data.js_stats!
                      // 各指标：[原始值, 是否越小越优]
                      type MetricDef = { label: string; vals: number[]; fmt: (v: number, s: JsExecStats) => string; lowerBetter: boolean }
                      const metrics: MetricDef[] = [
                        { label: '调用次数', vals: stats.map(s => s.idle_calls),        fmt: v => v.toLocaleString(),        lowerBetter: true  },
                        { label: '峰值内存', vals: stats.map(s => s.peak_memory_bytes), fmt: v => fmtMem(v),                 lowerBetter: true  },
                        { label: '平均耗时', vals: stats.map(s => s.avg_exec_us),       fmt: v => fmtUs(v),                  lowerBetter: true  },
                        { label: '最大耗时', vals: stats.map(s => s.max_exec_us),       fmt: v => fmtUs(v),                  lowerBetter: true  },
                        { label: '命令数',   vals: stats.map(s => s.commands_issued),   fmt: v => v.toLocaleString(),        lowerBetter: false },
                        { label: '空调用率', vals: stats.map(s => s.idle_calls > 0 ? s.empty_calls / s.idle_calls : 0),
                          fmt: (v) => v === 0 ? '0%' : `${(v * 100).toFixed(0)}%`, lowerBetter: true },
                      ]
                      // 为每个指标计算每个坦克的胜负（仅 2 个坦克时有意义）
                      const winnerIdx = (m: MetricDef): number | null => {
                        if (stats.length < 2) return null
                        const [a, b] = m.vals
                        if (a === b) return null
                        return m.lowerBetter ? (a < b ? 0 : 1) : (a > b ? 0 : 1)
                      }

                      return stats.map((s, i) => {
                        const col = i === 0 ? "#3b82f6" : "#ef4444"
                        return (
                          <div key={s.tank_name} className="px-4 py-3 flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="size-2 rounded-full shrink-0" style={{ background: col }} />
                              <span className="text-xs font-semibold text-white">{s.tank_name}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              {metrics.map(m => {
                                const wi = winnerIdx(m)
                                const isWinner = wi === i
                                const isLoser  = wi !== null && wi !== i
                                const valColor = isWinner ? 'text-green-400' : isLoser ? 'text-zinc-500' : 'text-zinc-300'
                                return (
                                  <div key={m.label} className="flex justify-between gap-1">
                                    <span className="text-[10px] text-zinc-500">{m.label}</span>
                                    <span className={`text-[10px] tabular-nums font-medium ${valColor}`}>
                                      {isWinner && <span className="mr-0.5 text-[9px]">▲</span>}
                                      {m.fmt(m.vals[i], s)}
                                    </span>
                                  </div>
                                )
                              })}
                              {s.error_count > 0 && (
                                <div className="col-span-2 flex justify-between gap-1">
                                  <span className="text-[10px] text-zinc-500">错误数</span>
                                  <span className="text-[10px] tabular-nums text-red-400 font-medium">{s.error_count}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              )
            })()}

            {/* 战报 —— flex-1 填充剩余空间 */}
            <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col min-h-0">
              <div className="border-b border-zinc-800 px-4 py-2.5 shrink-0">
                <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">战报</p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1 min-h-0">
                {data.battle_log.map((line, i) => {
                  const m = line.match(/\[(?:Turn|Tick)\s*(\d+)\]/i)
                  const tick = m ? Number(m[1]) : null
                  return (
                    <p key={i} className={`text-[11px] leading-relaxed transition-colors ${
                      tick !== null && tick <= frameIdx ? "text-zinc-300" : "text-zinc-600"
                    }`}>{line}</p>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
