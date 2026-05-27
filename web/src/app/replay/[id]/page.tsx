"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Play, Pause, SkipBack, ArrowLeft, Volume2, VolumeX, Loader2, Trophy, Swords, Zap, Video, Share2, Check } from "lucide-react"
import * as PIXI from "pixi.js"

// ── 数据类型 ──────────────────────────────────────────────────
interface TankSnapshot {
  id: number; name: string; x: number; y: number
  body_angle: number; hp: number; alive: boolean; score: number
  team_id?: number
  shielded?: boolean; cloaked?: boolean; boosted?: boolean; overloaded?: boolean
  frozen?: boolean; stunned?: boolean; poisoned?: boolean
}
interface BulletSnapshot { id: number; x: number; y: number; owner_id: number; vx: number; vy: number }
interface StarSnapshot   { x: number; y: number }
interface FrameData {
  tick: number
  tanks: TankSnapshot[]
  bullets: BulletSnapshot[]
  stars: StarSnapshot[]
  destroyed_mounds?: [number, number][]
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
  winner: string; winner_label?: string; winner_team?: number; total_ticks: number; timed_out?: boolean
  arena: { map: string[] }
  telemetry: FrameData[]
  battle_log: string[]
  skins?: Record<string, { svg?: string; bullet_style?: string; trail_style?: string; name_color?: string }>
  js_stats?: JsExecStats[]
}

// ── 拖尾样式 ──────────────────────────────────────────────────────
const TRAIL_COLORS: Record<string, number> = {
  default: 0xffffff,
  neon:    0x00f5d4,
  fire:    0xff6b35,
  plasma:  0xa855f7,
}
const TRAIL_LEN = 8  // 保留最近 N 帧的位置历史

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

// ── 音效 ──────────────────────────────────────────────────────
type SFXNote = { freq: number; type: OscillatorType; t: number; dur: number; vol: number }

function _playSFX(notes: SFXNote[]) {
  const ctx = new AudioContext()
  ctx.resume().then(() => {
    const maxEnd = Math.max(...notes.map(n => n.t + n.dur)) + 0.1
    notes.forEach(({ freq, type, t, dur, vol }) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      gain.gain.setValueAtTime(vol, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + dur)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + dur + 0.02)
    })
    setTimeout(() => ctx.close(), maxEnd * 1000 + 200)
  })
}

function playVictorySFX() {
  _playSFX([
    // 快速上行琶音 C5→E5→G5→C6
    { freq: 523.25, type: 'square', t: 0.00, dur: 0.12, vol: 0.10 },
    { freq: 659.25, type: 'square', t: 0.09, dur: 0.12, vol: 0.10 },
    { freq: 783.99, type: 'square', t: 0.18, dur: 0.12, vol: 0.10 },
    { freq: 1046.5, type: 'square', t: 0.27, dur: 0.12, vol: 0.10 },
    // 最终和弦持音
    { freq: 1046.5, type: 'square', t: 0.44, dur: 0.75, vol: 0.08 },
    { freq:  783.99, type: 'square', t: 0.46, dur: 0.73, vol: 0.06 },
    { freq:  659.25, type: 'square', t: 0.48, dur: 0.71, vol: 0.05 },
  ])
}

function playDefeatSFX() {
  _playSFX([
    // 下行小调 G4→F4→Eb4→C4，锯齿波营造沉重感
    { freq: 392.00, type: 'sawtooth', t: 0.00, dur: 0.28, vol: 0.07 },
    { freq: 349.23, type: 'sawtooth', t: 0.24, dur: 0.28, vol: 0.07 },
    { freq: 311.13, type: 'sawtooth', t: 0.48, dur: 0.28, vol: 0.07 },
    { freq: 261.63, type: 'sawtooth', t: 0.72, dur: 0.65, vol: 0.06 },
    // 低沉叹息尾音
    { freq: 130.81, type: 'sawtooth', t: 0.90, dur: 0.55, vol: 0.04 },
  ])
}

// ── 常量 ──────────────────────────────────────────────────────
const WORLD  = 800
const TILE   = 40
const VIEW   = 560
const S      = VIEW / WORLD   // 0.7
const TS     = TILE * S       // 28px on screen
const MS_PER_TICK = 200

const PALETTE = [
  { body: 0x3b82f6, dark: 0x1e3a8a },
  { body: 0xef4444, dark: 0x7f1d1d },
  { body: 0x22c55e, dark: 0x14532d },
  { body: 0xa78bfa, dark: 0x4c1d95 },
]

// 2v2 队伍调色板：队伍 0 = 青色，队伍 1 = 品红
const TEAM_PIXI_PALETTE = [
  { body: 0x00f5d4, dark: 0x005544 },
  { body: 0xff3af2, dark: 0x7f1d6e },
]

// ── 星星 SVG ──────────────────────────────────────────────────
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <polygon points="20,3 24.5,15 38,15 27,23 31,36 20,28 9,36 13,23 2,15 15.5,15"
    fill="#FFE600" opacity="0.95"/>
  <polygon points="20,3 24.5,15 38,15 27,23 31,36 20,28 9,36 13,23 2,15 15.5,15"
    fill="none" stroke="#FF3AF2" stroke-width="1.2" opacity="0.7"/>
  <polygon points="20,8 23.5,16.5 33,16.5 25.5,22 28,31 20,25.5 12,31 14.5,22 7,16.5 16.5,16.5"
    fill="#FFF0A0" opacity="0.45"/>
</svg>`

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
  onCanvasReady?: (canvas: HTMLCanvasElement) => void
  onFps?: (fps: number) => void
}

function PixiView({ data, playing, seekFn, onTick, onEnd, onCanvasReady, onFps }: PixiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // ── 坦克 sprite 映射 ──────────────────────────────────────
  type TankSprites = {
    root: PIXI.Container; body: PIXI.Container; flash: PIXI.Graphics
    hpBar: PIXI.Graphics; scoreText: PIXI.Text; nameLabel: PIXI.Text
    statusRing: PIXI.Graphics; statusIcon: PIXI.Text
    _lastHp: number; _lastScore: number; _lastStatus: string
  }
  const tanks        = useRef<Map<number, TankSprites>>(new Map())
  const bullets      = useRef<PIXI.Graphics[]>([])
  const bulletStyles = useRef<string[]>([])   // 每个 bullet graphic 当前已绘制的样式 key
  const stars        = useRef<PIXI.Sprite[]>([])
  const bLayer       = useRef<PIXI.Container | null>(null)
  const sLayer       = useRef<PIXI.Container | null>(null)
  const moundSprites = useRef<Map<string, PIXI.Sprite>>(new Map())

  // ── 拖尾 ──────────────────────────────────────────────────
  type TrailState = { positions: Array<{x: number; y: number}>; dots: PIXI.Graphics[] }
  const trails  = useRef<Map<number, TrailState>>(new Map())
  const tLayer  = useRef<PIXI.Container | null>(null)

  // ── 命中特效 ──────────────────────────────────────────────
  type Explosion = { x: number; y: number; g: PIXI.Graphics; t: number; color: number }
  const hitFlashes   = useRef<Map<number, number>>(new Map())   // tank_id → elapsed_ms
  const explosions   = useRef<Explosion[]>([])
  const fxLayer      = useRef<PIXI.Container | null>(null)

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
    onCanvasReady?.(app.view as HTMLCanvasElement)

    // ── 地图（SVG Sprite 贴图）───────────────────────────
    const mapC = new PIXI.Container()
    const moundMap = new Map<string, PIXI.Sprite>()
    data.arena.map.forEach((row, r) =>
      row.split('').forEach((ch, c) => {
        const sp = makeTileSprite(ch, c * TS, r * TS)
        mapC.addChild(sp)
        if (ch === 'm') moundMap.set(`${c},${r}`, sp)
      })
    )
    moundSprites.current = moundMap
    app.stage.addChild(mapC)

    // ── 图层 ────────────────────────────────────────────
    const starLayer   = new PIXI.Container(); app.stage.addChild(starLayer);   sLayer.current = starLayer
    const bulletLayer = new PIXI.Container(); app.stage.addChild(bulletLayer); bLayer.current = bulletLayer
    const trailLayer  = new PIXI.Container(); app.stage.addChild(trailLayer);  tLayer.current = trailLayer
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

    // 特效层：在草地覆盖层上方（命中闪光 / 爆炸粒子）
    const fxL = new PIXI.Container(); app.stage.addChild(fxL); fxLayer.current = fxL

    // ── 坦克容器 ─────────────────────────────────────────
    data.telemetry[0]?.tanks.forEach(t => {
      const root = new PIXI.Container()
      root.x = t.x * S; root.y = t.y * S

      const body = new PIXI.Container()
      body.rotation = t.body_angle

      const skin = data.skins?.[t.name]
      if (skin?.svg) {
        const sp = PIXI.Sprite.from(svgUrl(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -14 40 28" width="200" height="140">${skin.svg}</svg>`
        ))
        sp.width = TS * 1.25; sp.height = TS * 0.875; sp.anchor.set(0.5)
        body.addChild(sp)
      } else {
        const teamId = t.team_id ?? (t.id % 2)
        const pal = (data.telemetry[0]?.tanks.length ?? 0) >= 3
          ? TEAM_PIXI_PALETTE[teamId % 2]
          : PALETTE[t.id % PALETTE.length]
        const g = new PIXI.Graphics()
        // 履带
        g.beginFill(pal.dark).drawRoundedRect(-TS * 0.4, -TS * 0.28, TS * 0.8, TS * 0.11, 2).endFill()
        g.beginFill(pal.dark).drawRoundedRect(-TS * 0.4,  TS * 0.17, TS * 0.8, TS * 0.11, 2).endFill()
        // 车体
        g.beginFill(pal.body).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3).endFill()
        // 炮管（朝右 = body_angle=0 对应 East）
        g.beginFill(pal.dark).drawRoundedRect(TS * 0.05, -TS * 0.06, TS * 0.5, TS * 0.12, 2).endFill()
        body.addChild(g)
        body.scale.set(1.25)
      }

      // HP 条（不随 body 旋转，固定朝上）
      const hpBar = new PIXI.Graphics()
      hpBar.y = -TS * 0.58

      // 分数（只在 score > 0 时可见）
      const scoreText = new PIXI.Text('', new PIXI.TextStyle({
        fontSize: 9, fill: 0xFFE600, fontFamily: 'monospace', fontWeight: 'bold',
        dropShadow: true, dropShadowDistance: 1, dropShadowColor: 0x000000, dropShadowAlpha: 0.9,
      }))
      scoreText.anchor.set(0.5, 1)
      scoreText.y = -TS * 0.6

      // 命中闪光覆盖（在 body 上层，初始不可见）
      const flash = new PIXI.Graphics()

      // 技能状态光环（护盾/隐身/加速/过载等）
      const statusRing = new PIXI.Graphics()

      // 技能状态图标（❄冻结 ⚡眩晕 ✦中毒）
      const statusIcon = new PIXI.Text('', new PIXI.TextStyle({
        fontSize: 11, fill: 0xffffff, fontFamily: 'monospace',
        dropShadow: true, dropShadowDistance: 1, dropShadowColor: 0x000000, dropShadowAlpha: 1,
      }))
      statusIcon.anchor.set(0.5, 1)
      statusIcon.y = -TS * 0.72

      // 坦克名字标签（颜色来自装备的名字皮肤）
      const NAME_COLOR_PIXI: Record<string, number> = {
        magenta: 0xFF3AF2, cyan: 0x00F5D4, yellow: 0xFFE600, orange: 0xFF6B35, purple: 0xB45FFF,
      }
      const namePixiColor = NAME_COLOR_PIXI[data.skins?.[t.name]?.name_color ?? ''] ?? 0xffffff
      const nameLabel = new PIXI.Text(t.name, new PIXI.TextStyle({
        fontSize: 9, fill: namePixiColor, fontFamily: 'monospace', fontWeight: 'bold',
        dropShadow: true, dropShadowDistance: 1, dropShadowColor: 0x000000, dropShadowAlpha: 1,
      }))
      nameLabel.anchor.set(0.5, 1)
      nameLabel.y = -TS * 0.75

      root.addChild(statusRing)
      root.addChild(body)
      root.addChild(hpBar)
      root.addChild(scoreText)
      root.addChild(statusIcon)
      root.addChild(nameLabel)
      root.addChild(flash)
      tankLayer.addChild(root)

      // 初始绘制 HP 条
      const initPct = Math.max(0, t.hp / 100)
      const bw = TS * 0.7
      hpBar.beginFill(0x000000, 0.45).drawRect(-bw / 2, 0, bw, 3).endFill()
      hpBar.beginFill(0x4ade80, 0.9).drawRect(-bw / 2, 0, bw * initPct, 3).endFill()

      tanks.current.set(t.id, { root, body, flash, hpBar, scoreText, nameLabel, statusRing, statusIcon, _lastHp: t.hp, _lastScore: t.score, _lastStatus: '' })
    })

    // ── 拖尾 dot 对象池 ───────────────────────────────────
    trails.current.clear()
    data.telemetry[0]?.tanks.forEach(t => {
      const styleName = data.skins?.[t.name]?.trail_style
      if (!styleName || styleName === 'default') return  // 未购买拖尾则不创建
      const trailColor = TRAIL_COLORS[styleName] ?? 0xffffff
      const dots: PIXI.Graphics[] = []
      for (let i = 0; i < TRAIL_LEN; i++) {
        const g = new PIXI.Graphics()
        const r = Math.max(1.2, 3.8 - i * 0.35)
        g.beginFill(trailColor, 1).drawCircle(0, 0, r).endFill()
        g.visible = false
        trailLayer.addChild(g)
        dots.push(g)
      }
      trails.current.set(t.id, { positions: [], dots })
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
    let fpsFrameCount = 0
    app.ticker.add(() => {
      const now = performance.now()
      const dt  = now - lastMs.current   // 真实帧间距（ms）
      lastMs.current = now

      // 每 30 帧上报一次 FPS，避免频繁触发 React re-render
      if (onFps && ++fpsFrameCount >= 30) {
        fpsFrameCount = 0
        onFps(Math.round(app.ticker.FPS))
      }

      // 1. seek
      if (seekPend.current !== null) {
        const si = seekPend.current; seekPend.current = null
        idx.current  = si
        prev.current = si > 0 ? data.telemetry[si - 1] : null
        curr.current = data.telemetry[si] ?? null
        bMatches.current = matchBullets(prev.current?.bullets ?? [], curr.current?.bullets ?? [])
        accum.current = MS_PER_TICK   // 立即定位到目标帧，alpha=1
        // 清除 seek 跳跃残留的特效，并强制 HP/score 重绘
        hitFlashes.current.clear()
        tanks.current.forEach(sp => { sp.flash.clear(); sp.statusRing.clear(); sp.statusIcon.text = ''; sp._lastHp = -1; sp._lastScore = -1; sp._lastStatus = '' })
        explosions.current.forEach(ex => { ex.g.parent?.removeChild(ex.g); ex.g.destroy() })
        explosions.current = []
        // 清除拖尾历史
        trails.current.forEach(tr => { tr.positions = []; tr.dots.forEach(d => { d.visible = false }) })
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

            // 命中检测 & 拖尾采样
            if (prev.current && curr.current) {
              prev.current.tanks.forEach(pt => {
                const ct = curr.current!.tanks.find(x => x.id === pt.id)
                if (ct && ct.hp < pt.hp) hitFlashes.current.set(pt.id, 0)
                // 移动时追加位置；静止时每帧收缩一格，让拖尾自然消失
                const tr = trails.current.get(pt.id)
                if (tr) {
                  if (ct?.alive && (pt.x !== ct.x || pt.y !== ct.y)) {
                    tr.positions.unshift({ x: pt.x * S, y: pt.y * S })
                    if (tr.positions.length > TRAIL_LEN) tr.positions.pop()
                  } else if (tr.positions.length > 0) {
                    tr.positions.pop()
                  }
                }
              })
              const currBulletIds = new Set(curr.current.bullets.map(b => b.id))
              prev.current.bullets.forEach(b => {
                if (!currBulletIds.has(b.id) && fxLayer.current) {
                  const color = (ownerStyleMap.current.get(b.owner_id) ?? BULLET_STYLE_DEFS.default).color
                  const g = new PIXI.Graphics()
                  fxLayer.current.addChild(g)
                  // 偏移一格到实际碰撞点（遥测记录的是移动前位置）
                  explosions.current.push({ x: (b.x + b.vx * TILE) * S, y: (b.y + b.vy * TILE) * S, g, t: 0, color })
                }
              })
              // 土堆新摧毁检测
              const prevDmSet = new Set((prev.current.destroyed_mounds ?? []).map(([dc, dr]) => `${dc},${dr}`))
              ;(curr.current.destroyed_mounds ?? []).forEach(([col, row]) => {
                if (!prevDmSet.has(`${col},${row}`) && fxLayer.current) {
                  const g = new PIXI.Graphics()
                  fxLayer.current.addChild(g)
                  explosions.current.push({ x: (col * 40 + 20) * S, y: (row * 40 + 20) * S, g, t: 0, color: 0xb56030 })
                }
              })
            }

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

        // HP 条（只在 HP 变化时重绘，避免无效消耗）
        if (sp._lastHp !== t.hp) {
          sp._lastHp = t.hp
          const pct = Math.max(0, t.hp / 100)
          const bw  = TS * 0.7
          const col = pct > 0.5 ? 0x4ade80 : pct > 0.25 ? 0xfbbf24 : 0xef4444
          sp.hpBar.clear()
          sp.hpBar.beginFill(0x000000, 0.45).drawRect(-bw / 2, 0, bw, 3).endFill()
          if (pct > 0) sp.hpBar.beginFill(col, 0.9).drawRect(-bw / 2, 0, bw * pct, 3).endFill()
        }
        sp.hpBar.visible = t.alive

        // 分数文字（只在变化时更新）
        if (sp._lastScore !== t.score) {
          sp._lastScore = t.score
          sp.scoreText.text = t.score > 0 ? `★ ${t.score}` : ''
        }
        sp.scoreText.visible = t.alive && t.score > 0

        // 角度插值（处理 ±π 跳变），用 ease-in-out 让转向更自然
        const ea = alpha < 0.5 ? 2 * alpha * alpha : 1 - Math.pow(-2 * alpha + 2, 2) / 2
        const fa = pt ? pt.body_angle : t.body_angle
        let da = t.body_angle - fa
        if (da >  Math.PI) da -= Math.PI * 2
        if (da < -Math.PI) da += Math.PI * 2
        sp.body.rotation = fa + da * ea

        // ── 技能状态特效（只在状态变化时重绘）────────────────────
        const statusKey = [
          t.shielded ? 'S' : '', t.cloaked ? 'C' : '', t.boosted ? 'B' : '',
          t.overloaded ? 'O' : '', t.frozen ? 'F' : '', t.stunned ? 'N' : '', t.poisoned ? 'P' : '',
        ].join('')
        if (sp._lastStatus !== statusKey) {
          sp._lastStatus = statusKey
          sp.statusRing.clear()
          sp.statusIcon.text = ''

          // 隐身：坦克本体半透明
          sp.body.alpha = t.cloaked ? 0.32 : 1

          // 护盾：蓝色双层光环
          if (t.shielded) {
            sp.statusRing.lineStyle(2.5, 0x38bdf8, 0.9).drawCircle(0, 0, TS * 0.46)
            sp.statusRing.lineStyle(1,   0x7dd3fc, 0.45).drawCircle(0, 0, TS * 0.54)
          }
          // 过载：橙色内圈光环
          if (t.overloaded) {
            sp.statusRing.lineStyle(2, 0xf97316, 0.85).drawCircle(0, 0, TS * 0.38)
            sp.statusRing.beginFill(0xf97316, 0.12).drawCircle(0, 0, TS * 0.38).endFill()
          }
          // 加速：青绿色弧形尾迹
          if (t.boosted) {
            sp.statusRing.lineStyle(2, 0x4ade80, 0.7).drawCircle(0, 0, TS * 0.42)
            sp.statusRing.lineStyle(1, 0x86efac, 0.35).drawCircle(0, 0, TS * 0.50)
          }
          // 冻结：青色覆盖 + ❄
          if (t.frozen) {
            sp.statusRing.beginFill(0x67e8f9, 0.28).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3).endFill()
            sp.statusRing.lineStyle(1.5, 0x22d3ee, 0.8).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3)
            sp.statusIcon.text = '❄'
            sp.statusIcon.style.fill = 0x67e8f9
          }
          // 眩晕：黄色 ⚡
          if (t.stunned) {
            sp.statusRing.beginFill(0xfde047, 0.18).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3).endFill()
            sp.statusIcon.text = '⚡'
            sp.statusIcon.style.fill = 0xfde047
          }
          // 中毒：绿色 ✦
          if (t.poisoned) {
            sp.statusRing.beginFill(0x4ade80, 0.18).drawRoundedRect(-TS * 0.32, -TS * 0.22, TS * 0.64, TS * 0.44, 3).endFill()
            sp.statusRing.lineStyle(1, 0x86efac, 0.5).drawCircle(0, 0, TS * 0.44)
            sp.statusIcon.text = '☠'
            sp.statusIcon.style.fill = 0x86efac
          }
        }
        sp.statusRing.visible = t.alive
        sp.statusIcon.visible = t.alive
      })

      // 拖尾
      c.tanks.forEach(t => {
        const tr = trails.current.get(t.id); if (!tr) return
        tr.dots.forEach((dot, i) => {
          if (i >= tr.positions.length || !t.alive) { dot.visible = false; return }
          dot.x     = tr.positions[i].x
          dot.y     = tr.positions[i].y
          dot.alpha = (1 - i / TRAIL_LEN) * 0.55
          dot.scale.set(1 - i * 0.09)
          dot.visible = true
        })
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
          // 新生成的子弹（pb=null）从炮主坦克位置飞出
          const ownerSnap = pb ? null : c.tanks.find(t => t.id === b.owner_id)
          const fx = pb ? pb.x * S : (ownerSnap ? ownerSnap.x * S : b.x * S)
          const fy = pb ? pb.y * S : (ownerSnap ? ownerSnap.y * S : b.y * S)
          g.x = fx + (b.x * S - fx) * alpha
          g.y = fy + (b.y * S - fy) * alpha
        })
      }

      // ── 命中闪光 ──────────────────────────────────────────
      hitFlashes.current.forEach((elapsed, tid) => {
        const sp = tanks.current.get(tid); if (!sp) return
        const newElapsed = elapsed + dt
        const progress   = newElapsed / 280   // 280ms 闪光周期
        if (progress >= 1) {
          hitFlashes.current.delete(tid)
          sp.flash.clear()
        } else {
          hitFlashes.current.set(tid, newElapsed)
          // 快速亮起（前 25%）→ 慢慢消散
          const a = progress < 0.25 ? progress / 0.25 : 1 - (progress - 0.25) / 0.75
          sp.flash.clear()
          sp.flash.beginFill(0xff6600, a * 0.55).drawCircle(0, 0, TS * 0.42).endFill()
          sp.flash.beginFill(0xffffff, a * 0.35).drawCircle(0, 0, TS * 0.22).endFill()
        }
      })

      // ── 爆炸粒子 ──────────────────────────────────────────
      explosions.current = explosions.current.filter(ex => {
        ex.t += dt
        const p = Math.min(ex.t / 380, 1)   // 380ms 寿命
        if (p >= 1) {
          ex.g.parent?.removeChild(ex.g)
          ex.g.destroy()
          return false
        }
        const inv = 1 - p
        ex.g.clear()
        ex.g.x = ex.x; ex.g.y = ex.y
        // 外环扩散
        ex.g.lineStyle(2.5 * inv, ex.color,        inv)
            .drawCircle(0, 0, 4 + p * 14)
        ex.g.lineStyle(1.5 * inv, 0xffffff,         inv * 0.6)
            .drawCircle(0, 0, 4 + p * 20)
        // 8 条闪光线
        for (let i = 0; i < 8; i++) {
          const ang  = (i / 8) * Math.PI * 2
          const len  = p * 11
          const cx   = Math.cos(ang); const cy = Math.sin(ang)
          ex.g.lineStyle(1.2, 0xfef08a, inv * 0.9)
              .moveTo(cx * 3, cy * 3)
              .lineTo(cx * (3 + len), cy * (3 + len))
        }
        return true
      })

      // 土堆摧毁
      const dm = c.destroyed_mounds ?? []
      moundSprites.current.forEach((sp, key) => {
        const [col, row] = key.split(',').map(Number)
        sp.visible = !dm.some(([dc, dr]) => dc === col && dr === row)
      })

      // 星星
      const sl = sLayer.current
      if (sl) {
        const ss = c.stars ?? []
        while (stars.current.length < ss.length) {
          const sp = PIXI.Sprite.from(svgUrl(STAR_SVG))
          sp.width = sp.height = 25; sp.anchor.set(0.5)
          sl.addChild(sp); stars.current.push(sp)
        }
        stars.current.forEach((sp, i) => {
          const s = ss[i]
          if (!s) { sp.visible = false; return }
          sp.visible = true; sp.x = s.x * S; sp.y = s.y * S
          sp.rotation += 0.008
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

  const [data,      setData]      = useState<BattleResult | null>(null)
  const [err,       setErr]       = useState<string | null>(null)
  const [frameIdx,  setFrameIdx]  = useState(0)
  const [playing,   setPlaying]   = useState(false)
  const [bgm,       setBgm]       = useState(true)
  const [recording, setRecording] = useState(false)
  const [fps,       setFps]       = useState<number | null>(null)
  const [loadedAt]                = useState(() => new Date())
  const [shared,    setShared]    = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)

  const seekFn        = useRef<((idx: number) => void) | null>(null)
  const sfxDone       = useRef(false)
  const pixiCanvas    = useRef<HTMLCanvasElement | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const recordChunks  = useRef<Blob[]>([])

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
    setPlaying(false); seekFn.current?.(0); setFrameIdx(0); sfxDone.current = false
  }

  async function handleDownloadVideo() {
    if (!data || !pixiCanvas.current || recording) return
    setRecording(true)
    setPlaying(false)
    setExportPct(0)

    const canvas = pixiCanvas.current
    // H.264 要求宽高为偶数
    const w = canvas.width  % 2 === 0 ? canvas.width  : canvas.width  - 1
    const h = canvas.height % 2 === 0 ? canvas.height : canvas.height - 1

    // WebCodecs 不支持时 fallback 到 MediaRecorder
    if (!('VideoEncoder' in window)) {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm'
      seekFn.current?.(0); setFrameIdx(0); sfxDone.current = false
      const stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType })
      recordChunks.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(recordChunks.current, { type: mimeType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `replay-${id}.webm`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setRecording(false); setExportPct(null)
      }
      mediaRecorder.current = recorder
      recorder.start(100); setPlaying(true)
      return
    }

    try {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer')
      const target = new ArrayBufferTarget()
      const muxer = new Muxer({
        target,
        video: { codec: 'avc', width: w, height: h },
        fastStart: 'in-memory',
      })

      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error('VideoEncoder:', e),
      })
      encoder.configure({
        codec: 'avc1.42001f',
        width: w, height: h,
        bitrate: 4_000_000,
        framerate: 5,
      })

      const TICK_US = 200 * 1_000  // 每帧 200ms，与前端 MS_PER_TICK 一致
      const total = data.telemetry.length
      const rAF = () => new Promise<void>(r => requestAnimationFrame(() => r()))

      for (let i = 0; i < total; i++) {
        seekFn.current?.(i)
        await rAF() // ticker 处理 seek（return 早退，不渲染）
        await rAF() // ticker 渲染这一帧
        const bitmap = await createImageBitmap(canvas, 0, 0, w, h)
        const frame = new VideoFrame(bitmap, {
          timestamp: i * TICK_US,
          duration:  TICK_US,
        })
        encoder.encode(frame, { keyFrame: i % 30 === 0 })
        frame.close(); bitmap.close()
        setExportPct(Math.round(((i + 1) / total) * 100))
      }

      await encoder.flush()
      muxer.finalize()

      const blob = new Blob([target.buffer], { type: 'video/mp4' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `replay-${id}.mp4`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setRecording(false); setExportPct(null)
      seekFn.current?.(0); setFrameIdx(0)
    }
  }

  const total  = data?.telemetry.length ?? 0
  const frame0 = data?.telemetry[0]
  const t0 = frame0?.tanks[0]
  const t1 = frame0?.tanks[1]
  const t2 = frame0?.tanks[2]
  const t3 = frame0?.tanks[3]
  const is2v2 = (frame0?.tanks.length ?? 0) >= 3
  const result = data ? (data.timed_out ? "超时" : "击败") : "—"

  if (err) return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0D0D1A] px-4">
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div
        className="relative rounded-3xl px-10 py-8 text-center"
        style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
      >
        <p className="text-3xl font-black uppercase tracking-tight text-[#FF6B35]" style={{ textShadow: "2px 2px 0 #FF3AF2" }}>
          加载失败
        </p>
        <p className="mt-2 text-sm font-bold text-[#FF6B35]/60">{err}</p>
      </div>
    </main>
  )

  if (!data) return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0D0D1A]">
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />
      <div className="relative flex flex-col items-center gap-4">
        <Loader2 className="size-10 animate-spin text-[#FF3AF2]" />
        <p className="text-sm font-black uppercase tracking-[0.3em] text-[#FF3AF2]">载入回放…</p>
      </div>
    </main>
  )

  const TEAM_COLORS = ["#00F5D4", "#FF3AF2"] as const

  function TankIcon({ name, teamId = 0, size = 56 }: { name: string; teamId?: number; size?: number }) {
    const skin  = data!.skins?.[name]
    const color = TEAM_COLORS[teamId % 2]
    return (
      <div
        className="shrink-0 overflow-hidden rounded-full flex items-center justify-center border-4"
        style={{
          width: size, height: size,
          borderColor: color,
          background: `${color}18`,
          boxShadow: `0 0 18px ${color}55`,
        }}
      >
        {skin?.svg
          ? <svg viewBox="-20 -14 40 28" width={size * 0.78} height={size * 0.55}
              dangerouslySetInnerHTML={{ __html: skin.svg }} />
          : <svg width={size * 0.48} height={size * 0.48} viewBox="0 0 20 20" fill="none">
              <rect x="2" y="6" width="16" height="8" rx="2" fill={color} />
              <rect x="8" y="2" width="5" height="7" rx="1" fill={color} opacity=".7" />
              <circle cx="5"  cy="15" r="2" fill={color} opacity=".6" />
              <circle cx="15" cy="15" r="2" fill={color} opacity=".6" />
            </svg>
        }
      </div>
    )
  }

  const winnerName = is2v2
    ? (data.winner_team !== undefined ? `Team ${data.winner_team === 0 ? "A" : "B"}` : data.winner_label ?? data.winner ?? "—")
    : (data.winner_label ?? data.winner ?? "—")

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-6">

      {/* Background */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.07]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />
      <div className="animate-max-float pointer-events-none absolute top-[4%] right-[3%] select-none text-4xl" aria-hidden="true">🏆</div>
      <div className="animate-max-bounce pointer-events-none absolute bottom-[8%] left-[2%] select-none text-3xl" aria-hidden="true">💥</div>

      <div className="relative mx-auto w-full max-w-[920px] flex flex-col gap-5">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 rounded-full border-4 border-dashed border-[#7B2FFF] px-4 py-1.5 text-sm font-black uppercase tracking-widest text-[#7B2FFF] transition-all duration-150 hover:bg-[#7B2FFF]/10 hover:scale-105"
          >
            <ArrowLeft className="size-4" /> 返回
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const url = window.location.href
                const shareData = { title: "Battle Replay", text: `${t0?.name ?? "?"} vs ${t1?.name ?? "?"}`, url }
                if (navigator.share && navigator.canShare?.(shareData)) {
                  await navigator.share(shareData).catch(() => {})
                } else {
                  await navigator.clipboard.writeText(url).catch(() => {})
                  setShared(true)
                  setTimeout(() => setShared(false), 2000)
                }
              }}
              className="flex items-center gap-2 rounded-full border-4 border-dashed border-[#00F5D4] px-4 py-1.5 text-sm font-black uppercase tracking-widest text-[#00F5D4] transition-all duration-150 hover:bg-[#00F5D4]/10 hover:scale-105"
            >
              {shared
                ? <><Check className="size-4" /> 已复制</>
                : <><Share2 className="size-4" /> 分享</>}
            </button>
            <div
              className="flex items-center gap-2 rounded-full border-4 px-4 py-1.5"
              style={{ borderColor: "#FF3AF2", background: "rgba(255,58,242,0.12)", boxShadow: "0 0 12px rgba(255,58,242,0.4)" }}
            >
              <span className="size-2 animate-pulse rounded-full bg-[#FF3AF2]" />
              <span className="text-xs font-black uppercase tracking-[0.3em] text-[#FF3AF2]">Battle Replay</span>
            </div>
          </div>
        </div>

        {/* ── Page title ── */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 font-mono text-xs font-black uppercase tracking-[0.4em] text-[#7B2FFF]">// battle replay</p>
            <h1
              className="text-3xl font-black uppercase tracking-tighter text-white md:text-4xl"
              style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2" }}
            >
              {is2v2 ? (
                <>
                  <span style={{ color: "#00F5D4" }}>Team A</span>
                  <span className="mx-3" style={{ color: "#FF3AF2" }}>vs</span>
                  <span style={{ color: "#FF3AF2" }}>Team B</span>
                </>
              ) : (
                <>
                  {t0?.name ?? "—"}
                  <span className="mx-3" style={{ color: "#FF3AF2" }}>vs</span>
                  {t1?.name ?? "—"}
                </>
              )}
            </h1>
            <p className="mt-1 text-xs font-medium text-white/35">{result} · {loadedAt.toLocaleString()}</p>
          </div>

          {/* Stat pills */}
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {([
              { label: "胜者", value: winnerName, color: "#FFE600", icon: <Trophy className="size-3" /> },
              { label: "结果", value: result,     color: "#FF3AF2", icon: <Swords className="size-3" /> },
              { label: "总帧", value: String(data.total_ticks), color: "#00F5D4", icon: <Zap className="size-3" /> },
            ] as const).map(({ label, value, color, icon }) => (
              <div
                key={label}
                className="flex flex-col rounded-2xl px-4 py-2.5"
                style={{ border: `4px solid ${color}`, background: `${color}12`, boxShadow: `0 0 10px ${color}40` }}
              >
                <div className="flex items-center gap-1 mb-0.5" style={{ color }}>
                  {icon}
                  <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
                </div>
                <span className="text-sm font-black text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── VS card ── */}
        <div
          className="overflow-hidden rounded-2xl"
          style={{ border: "4px solid #FF3AF2", boxShadow: "6px 6px 0 #FFE600, 12px 12px 0 #7B2FFF", background: "rgba(45,27,78,0.5)" }}
        >
          {is2v2 ? (
            /* 2v2 布局：双队列示 */
            <div className="flex items-stretch">
              {/* Team A */}
              <div className="flex flex-1 flex-col gap-2.5 px-5 py-4">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: "#00F5D4" }}>Team A</p>
                {[t0, t2].map(t => t && (
                  <div key={t.id} className="flex items-center gap-3">
                    <TankIcon name={t.name} teamId={0} size={40} />
                    <span className="truncate font-black text-white text-sm">{t.name}</span>
                  </div>
                ))}
                {data.winner_team === 0 && (
                  <span
                    className="w-fit rounded-full border-4 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest"
                    style={{ borderColor: "#FFE600", color: "#FFE600", background: "rgba(255,230,0,0.15)", boxShadow: "0 0 10px rgba(255,230,0,0.4)" }}
                  >
                    🏆 胜者
                  </span>
                )}
              </div>

              {/* VS 分隔 */}
              <div
                className="flex items-center justify-center px-5"
                style={{ borderLeft: "4px dashed rgba(255,58,242,0.3)", borderRight: "4px dashed rgba(255,58,242,0.3)" }}
              >
                <span className="text-xl font-black uppercase tracking-widest" style={{ color: "#FF3AF2", textShadow: "0 0 12px rgba(255,58,242,0.6)" }}>
                  VS
                </span>
              </div>

              {/* Team B */}
              <div className="flex flex-1 flex-col gap-2.5 px-5 py-4 items-end">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: "#FF3AF2" }}>Team B</p>
                {[t1, t3].map(t => t && (
                  <div key={t.id} className="flex items-center gap-3">
                    <span className="truncate font-black text-white text-sm">{t.name}</span>
                    <TankIcon name={t.name} teamId={1} size={40} />
                  </div>
                ))}
                {data.winner_team === 1 && (
                  <span
                    className="w-fit rounded-full border-4 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest"
                    style={{ borderColor: "#FFE600", color: "#FFE600", background: "rgba(255,230,0,0.15)", boxShadow: "0 0 10px rgba(255,230,0,0.4)" }}
                  >
                    🏆 胜者
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* 1v1 布局 */
            <div className="flex items-stretch">
              {/* Tank 1 */}
              <div className="flex flex-1 items-center gap-4 px-6 py-4">
                <TankIcon name={t0?.name ?? ""} teamId={0} size={52} />
                <div className="flex flex-col gap-1 min-w-0">
                  <p className="truncate font-black text-white text-lg" style={{ textShadow: `1px 1px 0 ${TEAM_COLORS[0]}` }}>
                    {t0?.name ?? "—"}
                  </p>
                  {data.winner === t0?.name && (
                    <span
                      className="w-fit rounded-full border-4 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest"
                      style={{ borderColor: "#FFE600", color: "#FFE600", background: "rgba(255,230,0,0.15)", boxShadow: "0 0 10px rgba(255,230,0,0.4)" }}
                    >
                      🏆 胜者
                    </span>
                  )}
                </div>
              </div>

              {/* VS 分隔 */}
              <div
                className="flex flex-col items-center justify-center px-5"
                style={{ borderLeft: "4px dashed rgba(255,58,242,0.3)", borderRight: "4px dashed rgba(255,58,242,0.3)" }}
              >
                <span className="text-xl font-black uppercase tracking-widest" style={{ color: "#FF3AF2", textShadow: "0 0 12px rgba(255,58,242,0.6)" }}>
                  VS
                </span>
              </div>

              {/* Tank 2 */}
              <div className="flex flex-1 items-center justify-end gap-4 px-6 py-4">
                <div className="flex flex-col items-end gap-1 min-w-0">
                  <p className="truncate font-black text-white text-lg" style={{ textShadow: `1px 1px 0 ${TEAM_COLORS[1]}` }}>
                    {t1?.name ?? "—"}
                  </p>
                  {data.winner === t1?.name && (
                    <span
                      className="w-fit rounded-full border-4 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest"
                      style={{ borderColor: "#FFE600", color: "#FFE600", background: "rgba(255,230,0,0.15)", boxShadow: "0 0 10px rgba(255,230,0,0.4)" }}
                    >
                      🏆 胜者
                    </span>
                  )}
                </div>
                <TankIcon name={t1?.name ?? ""} teamId={1} size={52} />
              </div>
            </div>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="flex gap-5 items-start">

          {/* Canvas column */}
          <div className="flex flex-col gap-3 items-center">

            {/* Controls bar */}
            <div
              className="flex items-center gap-2 w-full rounded-2xl px-4 py-3"
              style={{ border: "4px solid rgba(123,47,255,0.5)", background: "rgba(45,27,78,0.4)" }}
            >
              <button
                onClick={handleReset}
                title="重置"
                className="flex size-8 shrink-0 items-center justify-center rounded-full border-4 border-dashed border-[#7B2FFF]/70 text-[#7B2FFF] transition-all duration-150 hover:bg-[#7B2FFF]/15 hover:scale-110"
              >
                <SkipBack className="size-3.5" />
              </button>
              <button
                onClick={handlePlayPause}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border-4 border-[#FFE600] text-white transition-all duration-200 hover:scale-110 active:scale-95"
                style={{ background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)", boxShadow: "0 0 14px rgba(255,58,242,0.5), 2px 2px 0 #FFE600" }}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <input
                type="range" min={0} max={Math.max(0, total - 1)} value={frameIdx}
                onChange={handleSlider}
                className="flex-1 accent-[#FF3AF2]"
                style={{ accentColor: "#FF3AF2" }}
              />
              <span className="w-20 shrink-0 text-right font-mono text-xs font-black tabular-nums text-[#FF3AF2]">
                {frameIdx + 1} / {total}
              </span>
              {fps !== null && (
                <span className="shrink-0 font-mono text-[10px] font-black tabular-nums text-white/40">
                  {fps} fps
                </span>
              )}
              <button
                onClick={() => setBgm(b => !b)}
                title={bgm ? "静音" : "开启音乐"}
                className="flex size-8 shrink-0 items-center justify-center rounded-full border-4 border-dashed border-[#00F5D4]/70 text-[#00F5D4] transition-all duration-150 hover:bg-[#00F5D4]/15 hover:scale-110"
              >
                {bgm ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              </button>
              <button
                onClick={handleDownloadVideo}
                disabled={recording}
                title={exportPct !== null ? `导出中 ${exportPct}%` : "导出 MP4"}
                className="flex size-8 shrink-0 items-center justify-center rounded-full border-4 border-dashed border-[#FFE600]/70 text-[#FFE600] transition-all duration-150 hover:bg-[#FFE600]/15 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100"
              >
                {exportPct !== null
                  ? <span className="text-[9px] font-black leading-none">{exportPct}%</span>
                  : <Video className="size-3.5" />
                }
              </button>
            </div>

            {/* Canvas with Maximalism border */}
            <div
              className="overflow-hidden rounded-2xl"
              style={{ border: "4px solid #FF3AF2", boxShadow: "8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF" }}
            >
              <PixiView
                data={data} playing={playing}
                seekFn={seekFn}
                onCanvasReady={(c) => { pixiCanvas.current = c }}
                onFps={setFps}
                onTick={setFrameIdx}
                onEnd={() => {
                  setPlaying(false)
                  if (mediaRecorder.current?.state === 'recording') {
                    mediaRecorder.current.stop()
                  }
                  if (bgm && !sfxDone.current && !data.timed_out) {
                    sfxDone.current = true
                    const won = is2v2
                      ? data.winner_team === 0
                      : data.winner === t0?.name
                    if (won) playVictorySFX()
                    else playDefeatSFX()
                  }
                }}
              />
            </div>
          </div>

          {/* Right panel */}
          <div className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto">

            {/* Tank status */}
            <div
              className="overflow-hidden rounded-2xl shrink-0"
              style={{ border: "4px solid #00F5D4", background: "rgba(45,27,78,0.5)", boxShadow: "4px 4px 0 rgba(0,245,212,0.3)" }}
            >
              <div className="px-4 py-2.5" style={{ borderBottom: "4px dashed rgba(0,245,212,0.4)", background: "rgba(13,13,26,0.4)" }}>
                <p className="text-xs font-black uppercase tracking-widest text-[#00F5D4]">坦克状态</p>
              </div>
              <div className="flex flex-col divide-y-2 divide-dashed divide-[#00F5D4]/20 px-4">
                {data.telemetry[frameIdx]?.tanks.map((t, i) => {
                  const col    = TEAM_COLORS[(t.team_id ?? i) % 2]
                  const hpPct  = Math.max(0, t.hp / 100)
                  const hpCol  = hpPct > 0.5 ? '#4ade80' : hpPct > 0.25 ? '#fbbf24' : '#ef4444'
                  return (
                    <div key={t.id} className="flex flex-col gap-1.5 py-3">
                      {/* 名字行 */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: col, boxShadow: `0 0 6px ${col}` }} />
                          <span className="truncate text-sm font-black text-white">{t.name}</span>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-black" style={{ color: '#FFE600' }}>
                          ★ {t.score}
                        </span>
                      </div>
                      {/* HP 条 */}
                      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(0,0,0,0.4)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-150"
                          style={{
                            width: t.alive ? `${hpPct * 100}%` : '100%',
                            background: t.alive ? hpCol : '#374151',
                            boxShadow: t.alive ? `0 0 5px ${hpCol}` : 'none',
                          }}
                        />
                      </div>
                      {/* HP 数值 */}
                      <span className="text-[10px] font-black tabular-nums" style={{ color: t.alive ? hpCol : '#4b5563' }}>
                        {t.alive ? `${t.hp} / 100 HP` : '已摧毁'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* JS execution stats */}
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
                <div
                  className="overflow-hidden rounded-2xl shrink-0"
                  style={{ border: "4px solid #7B2FFF", background: "rgba(45,27,78,0.5)", boxShadow: "4px 4px 0 rgba(123,47,255,0.3)" }}
                >
                  <div className="px-4 py-2.5" style={{ borderBottom: "4px dashed rgba(123,47,255,0.4)", background: "rgba(13,13,26,0.4)" }}>
                    <p className="text-xs font-black uppercase tracking-widest text-[#7B2FFF]">JS 执行统计</p>
                  </div>
                  <div className="flex flex-col divide-y-2 divide-dashed divide-[#7B2FFF]/20">
                    {(() => {
                      const stats = data.js_stats!
                      type MetricDef = { label: string; vals: number[]; fmt: (v: number, s: JsExecStats) => string; lowerBetter: boolean }
                      const metrics: MetricDef[] = [
                        { label: '调用次数', vals: stats.map(s => s.idle_calls),        fmt: v => v.toLocaleString(), lowerBetter: true  },
                        { label: '峰值内存', vals: stats.map(s => s.peak_memory_bytes), fmt: v => fmtMem(v),          lowerBetter: true  },
                        { label: '平均耗时', vals: stats.map(s => s.avg_exec_us),       fmt: v => fmtUs(v),           lowerBetter: true  },
                        { label: '最大耗时', vals: stats.map(s => s.max_exec_us),       fmt: v => fmtUs(v),           lowerBetter: true  },
                        { label: '命令数',   vals: stats.map(s => s.commands_issued),   fmt: v => v.toLocaleString(), lowerBetter: false },
                        { label: '空调用率', vals: stats.map(s => s.idle_calls > 0 ? s.empty_calls / s.idle_calls : 0),
                          fmt: v => v === 0 ? '0%' : `${(v * 100).toFixed(0)}%`, lowerBetter: true },
                      ]
                      const winnerIdx = (m: MetricDef): number | null => {
                        if (stats.length < 2) return null
                        const [a, b] = m.vals
                        if (a === b) return null
                        return m.lowerBetter ? (a < b ? 0 : 1) : (a > b ? 0 : 1)
                      }
                      return stats.map((s, i) => {
                        const col = TEAM_COLORS[i % 2]
                        return (
                          <div key={s.tank_name} className="px-4 py-3 flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="size-2 rounded-full shrink-0" style={{ background: col, boxShadow: `0 0 5px ${col}` }} />
                              <span className="text-xs font-black text-white">{s.tank_name}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                              {metrics.map(m => {
                                const wi = winnerIdx(m)
                                const isWinner = wi === i
                                const isLoser  = wi !== null && wi !== i
                                return (
                                  <div key={m.label} className="flex justify-between gap-1">
                                    <span className="text-[10px] text-white/35">{m.label}</span>
                                    <span className={`text-[10px] tabular-nums font-black ${isWinner ? "text-[#00F5D4]" : isLoser ? "text-white/30" : "text-white/70"}`}>
                                      {isWinner && <span className="mr-0.5 text-[9px]">▲</span>}
                                      {m.fmt(m.vals[i], s)}
                                    </span>
                                  </div>
                                )
                              })}
                              {s.error_count > 0 && (
                                <div className="col-span-2 flex justify-between gap-1">
                                  <span className="text-[10px] text-white/35">错误数</span>
                                  <span className="text-[10px] tabular-nums font-black text-[#FF6B35]">{s.error_count}</span>
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

            {/* Battle log */}
            <div
              className="flex flex-1 flex-col overflow-hidden rounded-2xl min-h-0"
              style={{ border: "4px solid #FF6B35", background: "rgba(45,27,78,0.5)", boxShadow: "4px 4px 0 rgba(255,107,53,0.3)" }}
            >
              <div className="shrink-0 px-4 py-2.5" style={{ borderBottom: "4px dashed rgba(255,107,53,0.4)", background: "rgba(13,13,26,0.4)" }}>
                <p className="text-xs font-black uppercase tracking-widest text-[#FF6B35]">战报</p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5 min-h-0">
                {data.battle_log.map((line, i) => {
                  const m    = line.match(/\[(?:Turn|Tick)\s*(\d+)\]/i)
                  const tick = m ? Number(m[1]) : null
                  const past = tick !== null && tick <= frameIdx
                  // JS print() 输出：格式 [Turn XXXX][TankName] ...
                  const isDebug = /^\[(?:Turn|Tick)\s*\d+\]\[[^\]]+\]/.test(line)
                  // 关键事件关键词
                  const isHit      = line.includes('击中') || line.includes('摧毁')
                  const isSkill    = line.includes('中毒') || line.includes('冻结') || line.includes('眩晕') || line.includes('护盾') || line.includes('隐身') || line.includes('过载') || line.includes('传送') || line.includes('加速')
                  const isStar     = line.includes('星星') || line.includes('得分')
                  const isEnd      = line.includes('结束') || line.includes('胜者') || line.includes('═══')

                  let color: string
                  if (!past) {
                    color = "rgba(255,255,255,0.15)"
                  } else if (isDebug) {
                    color = "rgba(255,255,255,0.3)"
                  } else if (isEnd) {
                    color = "#FFE600"
                  } else if (isHit) {
                    color = "#FF6B35"
                  } else if (isSkill) {
                    color = "#a78bfa"
                  } else if (isStar) {
                    color = "#fbbf24"
                  } else {
                    color = "rgba(255,255,255,0.7)"
                  }

                  return (
                    <p
                      key={i}
                      className={`leading-relaxed transition-colors ${isDebug ? "text-[10px] font-mono pl-2 border-l border-white/10" : "text-[11px] font-medium"}`}
                      style={{ color }}
                    >
                      {line}
                    </p>
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
