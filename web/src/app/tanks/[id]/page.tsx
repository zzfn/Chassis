"use client"

import React, { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { ArrowLeft, Copy, Check, Loader2, CheckCircle, XCircle, Shield, Swords, Share2, X, Settings, User, Lock } from "lucide-react"
import { getCookie } from "@/lib/cookie"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"
const BOT_LABEL: Record<string, string> = { rusher: "冲锋者", circler: "侧翼手", sniper: "狙击手" }

interface Battle {
  id: string
  challenger: string
  opponent: string
  winner: string
  total_ticks: number
  created_at: string
}

interface TankDetail {
  agent_id: string
  agent_name: string
  owner: string
  code: string
  created_at: string
  elo: number
  pvp_wins: number
  pvp_losses: number
  pvp_battles: number
  battles: Battle[]
}

interface ApiKey {
  id: string
  agent_name: string
  key: string
  created_at: string
}

interface TestResult { opponent: string; winner: string; ticks: number }

interface AgentVersion {
  version: number
  agent_id: string
  code: string
  submitted_by: string | null
  created_at: string
}

interface TankSkin {
  svg?: string
  description?: string
  bullet_style?: string
}

const BULLET_STYLES = [
  { value: "default", label: "默认",  color: "#fef08a", shape: "circle"  },
  { value: "fire",    label: "火焰",  color: "#ff5500", shape: "circle"  },
  { value: "plasma",  label: "等离子", color: "#22d3ee", shape: "circle"  },
  { value: "void",    label: "虚空",  color: "#a855f7", shape: "diamond" },
  { value: "gold",    label: "黄金",  color: "#fbbf24", shape: "star"   },
] as const

const AI_OPTIONS = [
  { value: "",         label: "自己写的" },
  { value: "Claude",   label: "Claude" },
  { value: "GPT",      label: "ChatGPT" },
  { value: "Copilot",  label: "GitHub Copilot" },
  { value: "Gemini",   label: "Gemini" },
  { value: "Other",    label: "其他 AI" },
]

const AI_ICONS: Record<string, React.ReactNode> = {
  Claude:  <img src="/ai-icons/claude.ico"  width={14} height={14} className="inline-block rounded-sm" alt="Claude" />,
  GPT:     <img src="/ai-icons/gpt.ico"     width={14} height={14} className="inline-block rounded-sm" alt="GPT" />,
  Copilot: <img src="/ai-icons/copilot.ico" width={14} height={14} className="inline-block rounded-sm" alt="Copilot" />,
  Gemini:  <img src="/ai-icons/gemini.ico"  width={14} height={14} className="inline-block rounded-sm" alt="Gemini" />,
  Other: "🤖",
}

interface Achievement { label: string; icon: string; desc: string }
function getAchievements(wins: number, losses: number, battles: number): Achievement[] {
  const list: Achievement[] = []
  const rate = battles > 0 ? wins / battles : 0
  if (wins >= 100)  list.push({ label: "百战百胜", icon: "🏆", desc: "累计 100 胜" })
  if (wins >= 50)   list.push({ label: "沙场老将", icon: "⚔️", desc: "累计 50 胜" })
  if (wins >= 10)   list.push({ label: "初露锋芒", icon: "🌟", desc: "累计 10 胜" })
  if (rate >= 0.7 && battles >= 20) list.push({ label: "战无不胜", icon: "🛡️", desc: "20 场以上胜率 ≥70%" })
  if (battles >= 50) list.push({ label: "久经沙场", icon: "🔥", desc: "参与 50 场对战" })
  if (losses === 0 && battles >= 5) list.push({ label: "全胜将军", icon: "👑", desc: "5 场以上全胜" })
  return list
}

function getRankInfo(elo: number) {
  const tiers = [
    { min: 1800, max: 2200, tier: "钻石",  division: "I",   color: "#818cf8" },
    { min: 1500, max: 1800, tier: "铂金",  division: "I",   color: "#67e8f9" },
    { min: 1300, max: 1500, tier: "黄金",  division: "II",  color: "#fbbf24" },
    { min: 1100, max: 1300, tier: "白银",  division: "III", color: "#a1a1aa" },
    { min:    0, max: 1100, tier: "青铜",  division: "IV",  color: "#c2874f" },
  ]
  const t = tiers.find(t => elo >= t.min) ?? tiers[tiers.length - 1]
  const progress = Math.round(((elo - t.min) / (t.max - t.min)) * 100)
  return { tier: t.tier, division: t.division, score: Math.round(elo), progress: Math.min(progress, 99), color: t.color }
}

function TankAvatar({ name, skin }: { name: string; skin?: TankSkin }) {
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="relative flex size-24 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-600 text-2xl font-bold text-white shadow-lg overflow-hidden"
      style={{ background: `hsl(${hue},40%,${skin?.svg ? 10 : 22}%)` }}
    >
      {skin?.svg ? (
        <svg viewBox="-20 -14 40 28" width="88" height="62"
             dangerouslySetInnerHTML={{ __html: skin.svg }} />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </div>
  )
}

// 每种样式的颜色和辉光配置（与 BULLET_STYLES 对应）
const BULLET_PREVIEW_CFG: Record<string, { fill: string; glow?: string; r: number; shape: string }> = {
  default: { fill: "#fef08a", r: 3.5, shape: "circle" },
  fire:    { fill: "#ff5500", glow: "#ff220055", r: 4.5, shape: "circle" },
  plasma:  { fill: "#22d3ee", glow: "#0891b255", r: 4,   shape: "circle" },
  void:    { fill: "#a855f7", glow: "#6d28d955", r: 4.5, shape: "diamond" },
  gold:    { fill: "#fbbf24", r: 4.5, shape: "star" },
}

function BulletFirePreview({ bulletStyle, skinSvg }: { bulletStyle: string; skinSvg?: string }) {
  const cfg = BULLET_PREVIEW_CFG[bulletStyle] ?? BULLET_PREVIEW_CFG.default
  const dur = "1.1s"
  const begin = "0s"

  // 子弹形状路径（在 (0,0) 中心，用 transform 移动）
  const bulletShape = (() => {
    const { fill, r, shape } = cfg
    if (shape === "diamond") {
      const h = r * 1.4
      return <polygon points={`0,${-h} ${r},0 0,${h} ${-r},0`} fill={fill} />
    }
    if (shape === "star") {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2
        const rad = i % 2 === 0 ? r : r * 0.42
        pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`)
      }
      return <polygon points={pts.join(" ")} fill={fill} />
    }
    return <circle cx="0" cy="0" r={r} fill={fill} />
  })()

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
      <svg viewBox="0 0 280 72" width="100%" xmlns="http://www.w3.org/2000/svg">
        {/* 地面 */}
        <rect x="0" y="54" width="280" height="18" fill="#18181b" />
        <line x1="0" y1="54" x2="280" y2="54" stroke="#27272a" strokeWidth="1" />

        {/* 坦克（用皮肤 SVG 或简单占位） */}
        {skinSvg ? (
          <svg x="8" y="26" viewBox="-20 -14 40 28" width="52" height="36"
               dangerouslySetInnerHTML={{ __html: skinSvg }} />
        ) : (
          <g transform="translate(34,42)">
            {/* 履带 */}
            <rect x="-14" y="2"  width="28" height="5" rx="2" fill="#3f3f46" />
            {/* 车体 */}
            <rect x="-12" y="-6" width="24" height="10" rx="2" fill="#3b82f6" />
            {/* 炮塔 */}
            <rect x="-5"  y="-11" width="10" height="7" rx="1.5" fill="#2563eb" />
            {/* 炮管 */}
            <rect x="4"   y="-8.5" width="14" height="3" rx="1" fill="#1d4ed8" />
          </g>
        )}

        {/* 炮口闪光 */}
        {cfg.glow && (
          <circle cx="58" cy="42" r="0" fill={cfg.fill} opacity="0">
            <animate attributeName="r"       values="0;8;0"     dur={dur} repeatCount="indefinite" begin={begin} />
            <animate attributeName="opacity" values="0;0.6;0"   dur={dur} repeatCount="indefinite" begin={begin} />
          </circle>
        )}
        <circle cx="58" cy="42" r="0" fill={cfg.fill} opacity="0">
          <animate attributeName="r"       values="0;5;0"     dur={dur} repeatCount="indefinite" begin={begin} />
          <animate attributeName="opacity" values="0;0.9;0"   dur={dur} repeatCount="indefinite" begin={begin} />
        </circle>

        {/* 子弹轨迹（辉光圈） */}
        {cfg.glow && (
          <g opacity="0">
            <animateTransform attributeName="transform" type="translate"
              from="58 42" to="270 42"
              dur={dur} repeatCount="indefinite" begin={begin} calcMode="linear" />
            <animate attributeName="opacity" values="0;0;0.4;0.4;0" keyTimes="0;0.07;0.12;0.88;1"
              dur={dur} repeatCount="indefinite" begin={begin} />
            <circle cx="0" cy="0" r={(cfg.r * 1.9).toFixed(1)} fill={cfg.glow.slice(0, 7)} opacity="0.35" />
          </g>
        )}

        {/* 子弹本体 */}
        <g opacity="0">
          <animateTransform attributeName="transform" type="translate"
            from="58 42" to="270 42"
            dur={dur} repeatCount="indefinite" begin={begin} calcMode="linear" />
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.06;0.1;0.88;1"
            dur={dur} repeatCount="indefinite" begin={begin} />
          {bulletShape}
        </g>

        {/* 右侧淡出遮罩 */}
        <defs>
          <linearGradient id="fade-r" x1="0" x2="1">
            <stop offset="0%"   stopColor="#09090b" stopOpacity="0" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x="200" y="0" width="80" height="54" fill="url(#fade-r)" />
      </svg>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="rounded p-1.5 text-zinc-500 hover:text-white transition-colors">
      {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
    </button>
  )
}


export default function TankDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [tank, setTank] = useState<TankDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitResults, setSubmitResults] = useState<TestResult[] | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const [apiKey, setApiKey] = useState<ApiKey | null>(null)
  const [keyLoaded, setKeyLoaded] = useState(false)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [deletingKey, setDeletingKey] = useState(false)

  const [submittedBy, setSubmittedBy] = useState("")
  const [rightTab, setRightTab] = useState<"access" | "code">("access")
  const [bottomTab, setBottomTab] = useState<"history" | "versions">("history")
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [viewingCode, setViewingCode] = useState<AgentVersion | null>(null)

  // Manage 模态框
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTab, setManageTab] = useState<"profile" | "skill" | "appearance">("profile")
  const [renameTo, setRenameTo] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameOk, setRenameOk] = useState(false)
  const manageRef = useRef<HTMLDivElement>(null)

  // 皮肤状态
  const [skin, setSkin] = useState<TankSkin>({})
  const [skinDesc, setSkinDesc] = useState("")
  const [skinGenerating, setSkinGenerating] = useState(false)
  const [skinSaving, setSkinSaving] = useState(false)
  const [skinSaved, setSkinSaved] = useState(false)
  const [skinError, setSkinError] = useState<string | null>(null)

  // 分享弹窗
  const [shareOpen, setShareOpen] = useState(false)

  const isOwner = tank ? tank.owner === (getCookie("username") ?? "") : false

  async function loadTank() {
    const res = await fetch(`${apiBase}/api/tanks/${id}`)
    if (!res.ok) throw new Error("坦克不存在")
    const data: TankDetail = await res.json()
    setTank(data)
    setCode(data.code)
  }

  async function loadSkin() {
    const res = await fetch(`${apiBase}/api/tanks/${id}/skin`)
    if (res.ok) setSkin(await res.json())
  }

  async function generateSkin() {
    const token = getCookie("token")
    if (!token || !skinDesc.trim()) return
    setSkinGenerating(true); setSkinSaved(false); setSkinError(null)
    try {
      const res = await fetch(`${apiBase}/api/tanks/${id}/skin/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ description: skinDesc.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "生成失败")
      setSkin(data)
      setSkinSaved(true)
    } catch (err) {
      setSkinError(err instanceof Error ? err.message : "生成失败")
    } finally { setSkinGenerating(false) }
  }

  async function saveSkin() {
    const token = getCookie("token")
    if (!token) return
    setSkinSaving(true); setSkinSaved(false); setSkinError(null)
    try {
      const res = await fetch(`${apiBase}/api/tanks/${id}/skin`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(skin),
      })
      if (res.ok) setSkinSaved(true)
    } finally { setSkinSaving(false) }
  }

  async function loadKey() {
    const token = getCookie("token")
    if (!token) { setKeyLoaded(true); return }
    try {
      const res = await fetch(`${apiBase}/api/keys`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const keys: ApiKey[] = await res.json()
      const match = tank ? keys.find(k => k.agent_name === tank.agent_name) ?? null : null
      setApiKey(match)
    } finally {
      setKeyLoaded(true)
    }
  }

  useEffect(() => {
    if (!id) return
    loadTank().catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (tank) {
      loadSkin()
      if (isOwner) { loadKey(); loadVersions() }
    }
  }, [tank])

  // 皮肤预览 Canvas 重绘

  async function loadVersions() {
    if (versionsLoaded) return
    setVersionsLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/tanks/${id}/versions`)
      if (res.ok) setVersions(await res.json())
    } finally { setVersionsLoading(false); setVersionsLoaded(true) }
  }

  async function handleRename() {
    const token = getCookie("token")
    if (!token || !tank || !renameTo.trim()) return
    setRenaming(true); setRenameError(null); setRenameOk(false)
    try {
      const res = await fetch(`${apiBase}/api/tanks/${id}/rename`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameTo.trim() }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "重命名失败") }
      setRenameOk(true)
      await loadTank()
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "重命名失败")
    } finally { setRenaming(false) }
  }

  async function handleSubmit() {
    const token = getCookie("token")
    if (!token) { setSubmitError("请先登录"); return }
    setSubmitting(true); setSubmitError(null); setSubmitResults(null); setSubmitted(false)
    try {
      const res = await fetch(`${apiBase}/api/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: tank!.agent_name, code, submitted_by: submittedBy || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `提交失败 ${res.status}`)
      setSubmitResults(data.results ?? [])
      setSubmitted(true)
      loadTank().catch(() => {})
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function generateKey() {
    const token = getCookie("token")
    if (!token || !tank) return
    setGeneratingKey(true)
    try {
      const res = await fetch(`${apiBase}/api/keys`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agent_name: tank.agent_name }),
      })
      if (res.ok) setApiKey(await res.json())
    } finally { setGeneratingKey(false) }
  }

  async function deleteKey() {
    const token = getCookie("token")
    if (!token || !apiKey) return
    setDeletingKey(true)
    try {
      await fetch(`${apiBase}/api/keys/${apiKey.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
      setApiKey(null)
    } finally { setDeletingKey(false) }
  }

  if (loading) return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950">
      <Loader2 className="size-5 animate-spin text-zinc-500" />
    </main>
  )

  if (error || !tank) return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <Link href="/tanks" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white">
        <ArrowLeft className="size-4" /> 返回
      </Link>
      <p className="mt-4 rounded bg-red-950 px-3 py-2 text-sm text-red-400">{error ?? "坦克不存在"}</p>
    </main>
  )

  const winRate = tank.pvp_battles > 0 ? Math.round((tank.pvp_wins / tank.pvp_battles) * 100) : 0
  const rank = getRankInfo(tank.elo ?? 1000)
  const achievements = getAchievements(tank.pvp_wins, tank.pvp_losses, tank.pvp_battles)

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/tanks/${id}` : ""
  const shareModal = shareOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={e => { if (e.target === e.currentTarget) setShareOpen(false) }}
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
          <div>
            <h2 className="text-lg font-bold text-white">分享坦克</h2>
            <p className="mt-1 text-sm text-zinc-400">把链接发给朋友，他们可以围观或直接发起挑战。</p>
          </div>
          <button
            onClick={() => setShareOpen(false)}
            className="shrink-0 rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 坦克卡片 */}
        <div className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-950/40 p-5">
          <div
            className="flex size-20 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-600 text-2xl font-black text-white shadow-lg overflow-hidden"
            style={{ background: `hsl(${[...tank.agent_name].reduce((a,c)=>a+c.charCodeAt(0),0)%360},40%,${skin?.svg ? 10 : 22}%)` }}
          >
            {skin?.svg ? (
              <svg viewBox="-20 -14 40 28" width="72" height="50"
                   dangerouslySetInnerHTML={{ __html: skin.svg }} />
            ) : (
              tank.agent_name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <p className="text-lg font-bold text-white truncate">{tank.agent_name}</p>
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: rank.color }}>
              <Shield className="size-3.5" /> {rank.tier} {rank.division}
            </div>
            <p className="text-xs text-zinc-500">
              {tank.pvp_wins} 胜 · {tank.pvp_losses} 负 · 胜率 {winRate}%
            </p>
          </div>
        </div>

        {/* 分享链接 */}
        <div className="flex flex-col gap-2 p-5">
          <p className="text-xs font-semibold tracking-widest text-blue-400 uppercase">分享链接</p>
          <div className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-950 px-3 py-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 truncate bg-transparent font-mono text-xs text-zinc-300 focus:outline-none"
            />
            <CopyButton text={shareUrl} />
          </div>
        </div>
      </div>
    </div>
  )

  // ── 公开视图（非 Owner）──
  if (!isOwner) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 flex flex-col gap-6">

        <div className="flex items-center justify-between">
          <Link href="/tanks" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white">
            <ArrowLeft className="size-4" /> 返回坦克库
          </Link>
        </div>

        {/* 头部信息 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-3">
              <h1 className="text-3xl font-extrabold text-white">{tank.agent_name}</h1>
              <p className="text-sm text-zinc-500">拥有者：{tank.owner}</p>

              {/* 成就标签 */}
              {achievements.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {achievements.map(a => (
                    <span key={a.label} title={a.desc}
                      className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                      {a.icon} {a.label}
                    </span>
                  ))}
                </div>
              )}

              {/* 2×3 统计网格 */}
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  ["RANK",       `${rank.tier} ${rank.division}`],
                  ["RANK SCORE", rank.score.toString()],
                  ["RECORD",     `${tank.pvp_wins}-${tank.pvp_losses}-0`],
                  ["WIN RATE",   `${winRate}%`],
                  ["BATTLES",    tank.pvp_battles.toString()],
                  ["STATUS",     "活跃"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-4 py-3">
                    <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">{label}</p>
                    <p className="mt-1 text-lg font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>

              {/* 操作按钮 */}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  onClick={() => router.push(`/race?tank=${tank.agent_id}`)}
                  className="flex items-center gap-2 rounded-lg bg-red-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-600 transition-colors underline underline-offset-2"
                >
                  <Swords className="size-4" /> 挑战此坦克
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  <Share2 className="size-4" /> 分享
                </button>
              </div>
            </div>

            {/* 右侧头像 */}
            <div className="flex shrink-0 flex-col items-center gap-3">
              <div
                className="flex size-40 items-center justify-center rounded-xl border-2 border-zinc-600 text-5xl font-black text-white shadow-xl overflow-hidden"
                style={{ background: `hsl(${[...tank.agent_name].reduce((a,c)=>a+c.charCodeAt(0),0)%360},40%,${skin?.svg ? 10 : 18}%)` }}
              >
                {skin?.svg ? (
                  <svg viewBox="-20 -14 40 28" width="148" height="104"
                       dangerouslySetInnerHTML={{ __html: skin.svg }} />
                ) : (
                  tank.agent_name.slice(0,2).toUpperCase()
                )}
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-semibold" style={{ color: rank.color }}>
                <Shield className="size-3.5" /> {rank.tier} {rank.division}
              </div>
            </div>
          </div>
        </div>

        {/* Recent Battles */}
        <div className="rounded-xl border-2 border-zinc-700 bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-800/60 px-5 py-2.5">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-red-500" />
              <span className="text-xs font-bold tracking-widest text-zinc-400 uppercase">Recent Battles</span>
            </span>
          </div>

          <div className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
            <div className="flex flex-col gap-0 sm:border-r sm:border-zinc-800 sm:w-56 shrink-0 p-5">
              <h2 className="text-2xl font-black text-white">Recent Battles</h2>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">查看该坦克的最新公开对战记录，了解其战斗风格与表现。</p>
            </div>
            <div className="flex-1 divide-y divide-zinc-800">
              {tank.battles.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-zinc-600">暂无 PvP 对战记录</p>
              ) : tank.battles.map(battle => {
                const won = battle.winner === tank.agent_name
                const opponent = battle.challenger === tank.agent_name ? battle.opponent : battle.challenger
                return (
                  <div key={battle.id} className="flex items-center gap-3 px-5 py-3.5">
                    {/* W/L 方块 */}
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded border-2 text-xs font-black ${won ? "border-green-600 bg-green-950/60 text-green-400" : "border-zinc-700 bg-zinc-800/60 text-zinc-500"}`}>
                      {won ? "W" : "L"}
                    </div>
                    {/* 对手头像 */}
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded border border-zinc-700 text-xs font-bold text-white"
                      style={{ background: `hsl(${[...opponent].reduce((a,c)=>a+c.charCodeAt(0),0)%360},35%,20%)` }}
                    >
                      {opponent.slice(0,2).toUpperCase()}
                    </div>
                    {/* 信息 */}
                    <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                      <span className={`text-xs font-bold uppercase ${won ? "text-green-400" : "text-zinc-500"}`}>{won ? "WIN" : "LOSS"}</span>
                      <span className="text-sm font-semibold text-white truncate">{opponent}</span>
                      <span className="text-[11px] text-zinc-600">{new Date(battle.created_at).toLocaleString("zh-CN")} · {battle.total_ticks} 回合</span>
                    </div>
                    <Link href={`/replay/${battle.id}`}
                      className="shrink-0 rounded border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-400 hover:text-white transition-colors">
                      Watch replay
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {shareModal}
      </main>
    )
  }

  // ── Owner 管理视图 ──
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 flex flex-col gap-6">

      {/* ── 顶部操作栏 ── */}
      <div className="flex items-center justify-between">
        <Link href="/tanks" className="flex items-center gap-1.5 rounded border border-zinc-700 bg-transparent px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors">
          <ArrowLeft className="size-4" /> 返回坦克库
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
          >
            <Share2 className="size-4" /> 分享坦克
          </button>
          <button
            onClick={() => router.push(`/race?tank=${tank.agent_id}`)}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            <Swords className="size-4" /> 进入竞技场
          </button>
        </div>
      </div>

      {/* ── 标题区 ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">{tank.agent_name}</h1>
          <p className="text-sm text-zinc-500">当前对战记录：{tank.pvp_wins} 胜 · {tank.pvp_losses} 负</p>
          {achievements.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {achievements.map(a => (
                <span
                  key={a.label}
                  title={a.desc}
                  className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 cursor-default"
                >
                  <span>{a.icon}</span>{a.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <TankAvatar name={tank.agent_name} skin={skin} />
      </div>

      {/* ── 两列布局 ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">

        {/* 左：概况 */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-300">概况</h2>

          {/* 段位卡 */}
          <div className="rounded-lg border-2 border-yellow-600/40 bg-yellow-900/10 p-4">
            <p className="mb-1 text-xs text-zinc-500">段位</p>
            <div className="flex items-center gap-2">
              <Shield className="size-5" style={{ color: rank.color }} />
              <span className="text-xl font-bold text-white">{rank.tier} {rank.division}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
              <div className="h-full rounded-full transition-all" style={{ width: `${rank.progress}%`, backgroundColor: rank.color }} />
            </div>
            <p className="mt-1 text-xs text-zinc-500">{rank.progress}/100</p>
          </div>

          {/* 统计表 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800 text-sm">
            {[
              ["积分", rank.score.toString()],
              ["胜率", `${winRate}%`],
              ["战绩", `${tank.pvp_wins}-${tank.pvp_losses}-0`],
              ["状态", "活跃"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-zinc-500">{label}</span>
                <span className="font-semibold text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 右：Agent Access / 代码编辑器 */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex rounded-lg border border-zinc-700 p-0.5">
              <button
                onClick={() => setRightTab("access")}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${rightTab === "access" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                Agent Access
              </button>
              <button
                onClick={() => setRightTab("code")}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${rightTab === "code" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                代码编辑器
              </button>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  onClick={() => { setManageOpen(true); setRenameTo(tank.agent_name) }}
                  className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  <Settings className="size-3.5" /> 管理
                </button>
              )}
              {rightTab === "code" && isOwner && (
                <>
                  <select
                    value={submittedBy}
                    onChange={e => setSubmittedBy(e.target.value)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {AI_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition-colors"
                  >
                    {submitting ? <><Loader2 className="size-3.5 animate-spin" />测试中...</> : "提交更新"}
                  </button>
                </>
              )}
            </div>
          </div>

          {rightTab === "access" && (() => {
            const origin = typeof window !== "undefined" ? window.location.origin : ""
            const guideUrl = `${origin}/agent-guide`
            const keyValue = apiKey?.key ?? "<在下方点击「生成密钥」后填入>"
            const fullPrompt = `你正在协助玩家迭代 DeepTank 坦克竞技场的 AI 坦克 agent。

【任务】
为坦克 "${tank.agent_name}" 编写或改进 JavaScript 策略代码（onIdle 函数），目标是提升对战胜率。

【认证】
所有 API 请求在 HTTP 头携带：
Authorization: Bearer ${keyValue}

【API 服务器】
${apiBase}

【完整规范】
请先用 curl 读取以下页面，了解 onIdle 函数签名、坐标系、数据结构与全部接口字段：
${guideUrl}

【建议工作流】
1. GET  ${apiBase}/api/agent/tank
   读取当前代码、战绩、Elo、可用 bot 列表。
2. 分析现有代码与对战记录，提出改进策略。
3. POST ${apiBase}/api/agent/tank/simulate
   用草稿代码本地模拟对战（不计入战绩）。body: { "opponentId": "rusher"|"circler"|"sniper"|"camper", "code": "..." }
4. POST ${apiBase}/api/agent/tank/code
   发布新版本，会先与三个内置 bot 对战验证。body: { "code": "...", "notes": "改动说明", "submittedBy": "Claude" }
5. （可选）POST ${apiBase}/api/agent/tank/challenge
   挑战其他玩家坦克，战绩计入排行榜。body: { "opponentTankId": "<agent_id>" } 或 { "randomOpponent": true }

【运行时合约简要】
- 入口：function onIdle(me, enemy, game) { ... }
- 命令逐帧执行：me.go(n) / me.turn("left"|"right") / me.fire() / print(msg)
- 地图 20×20 格，4 向（north/east/south/west），子弹伤害 25，射击冷却 3 回合，最大 300 回合
- 坐标用 [col, row]，访问地图：game.map[row][col]；地图字符 'x' 永久墙 / 'm' 可破坏土堆 / 'o' 草丛 / '.' 地板
- enemy 可能为 null，必须做空值检查
- 仅支持纯 ES5，禁用 fetch/setTimeout/require，单次执行上限 10ms，内存 2MB

请先调用 GET ${apiBase}/api/agent/tank 读取上下文，并打印出当前代码与战绩，然后再开始迭代。`

            return (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Agent Access</h3>
                  <p className="mt-1 text-sm text-zinc-500">使用 Tank Key 让你的 Agent 读取、测试和更新这个坦克。下方的「完整 Prompt」可直接复制粘贴给任意 AI 助手。</p>
                </div>

                {/* 完整 Prompt —— 一键复制给 AI */}
                <div className="rounded border border-blue-700/60 bg-blue-950/20 overflow-hidden">
                  <div className="flex items-center justify-between bg-blue-900/30 px-3 py-1.5">
                    <span className="text-xs font-semibold tracking-widest text-blue-300">完整 PROMPT · 复制后直接发给 AI</span>
                    <CopyButton text={fullPrompt} />
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words bg-zinc-950 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
                    {fullPrompt}
                  </pre>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="rounded border border-zinc-700 overflow-hidden">
                    <div className="bg-zinc-800 px-3 py-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold tracking-widest text-blue-400">TANK KEY</span>
                      {isOwner && (
                        <button
                          onClick={generateKey}
                          disabled={generatingKey}
                          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-white disabled:opacity-40 transition-colors"
                        >
                          {generatingKey ? <Loader2 className="size-3 animate-spin" /> : "轮换密钥"}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 bg-zinc-900 px-3 py-2">
                      {apiKey ? (
                        <>
                          <code className="flex-1 truncate font-mono text-xs text-blue-300">{apiKey.key}</code>
                          <CopyButton text={apiKey.key} />
                        </>
                      ) : keyLoaded ? (
                        <span className="flex-1 text-xs text-zinc-600">未生成</span>
                      ) : (
                        <span className="flex-1 flex items-center gap-1.5 text-xs text-zinc-600">
                          <Loader2 className="size-3 animate-spin" /> 加载中…
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded border border-zinc-700 overflow-hidden">
                    <div className="bg-zinc-800 px-3 py-1.5">
                      <span className="text-xs font-semibold tracking-widest text-blue-400">GUIDE</span>
                    </div>
                    <div className="flex items-center gap-2 bg-zinc-900 px-3 py-2">
                      <span className="flex-1 truncate font-mono text-xs text-zinc-300">
                        {guideUrl}
                      </span>
                      <CopyButton text={guideUrl} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          {rightTab === "code" && (
            <div className="flex flex-col gap-2">
              <div className="overflow-hidden rounded-lg border border-zinc-800">
                <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-1.5">
                  <span className="font-mono text-xs text-zinc-600">agent.js</span>
                </div>
                {isOwner ? (
                  <MonacoEditor
                    height="320px"
                    defaultLanguage="javascript"
                    value={code}
                    onChange={val => setCode(val ?? "")}
                    theme="vs-dark"
                    options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 8, bottom: 8 } }}
                  />
                ) : (
                  <pre className="overflow-x-auto bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-300">{tank.code}</pre>
                )}
              </div>
              {submitError && <p className="rounded bg-red-950 px-3 py-2 text-xs text-red-400">{submitError}</p>}
              {submitted && submitResults && (
                <div className="flex flex-col gap-1.5">
                  <div className="rounded bg-green-950 px-3 py-2 text-center text-xs font-medium text-green-400">✓ 已更新到排行榜</div>
                  {submitResults.map(r => {
                    const won = r.winner === tank.agent_name
                    return (
                      <div key={r.opponent} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
                        <span className="text-xs text-zinc-300">vs {BOT_LABEL[r.opponent] ?? r.opponent}</span>
                        <div className="flex items-center gap-1.5">
                          {won ? <CheckCircle className="size-3.5 text-green-400" /> : <XCircle className="size-3.5 text-red-400" />}
                          <span className={`text-xs font-medium ${won ? "text-green-400" : "text-red-400"}`}>{won ? "胜" : "负"}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 底部标签 ── */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="flex border-b border-zinc-800 bg-zinc-900">
          <button
            onClick={() => setBottomTab("versions")}
            className={`flex-1 py-3 text-center text-sm font-semibold tracking-widest uppercase transition-colors ${
              bottomTab === "versions" ? "text-blue-400 border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClickCapture={() => loadVersions()}
          >
            版本记录（{versionsLoaded ? versions.length : "…"}）
          </button>
          <button
            onClick={() => setBottomTab("history")}
            className={`flex-1 py-3 text-center text-sm font-semibold tracking-widest uppercase transition-colors ${
              bottomTab === "history" ? "text-blue-400 border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            对战历史（{tank.battles.length}{tank.battles.length >= 10 ? "+" : ""}）
          </button>
        </div>

        {/* 版本记录 */}
        {bottomTab === "versions" && (
          <div className="divide-y divide-zinc-800">
            {versionsLoading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" /> 加载中...
              </div>
            )}
            {!versionsLoading && versions.length === 0 && (
              <p className="py-12 text-center text-sm text-zinc-600">暂无版本记录</p>
            )}
            {versions.map((v) => (
              <div key={v.agent_id} className="flex items-start gap-4 px-4 py-4">
                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">V{v.version}</span>
                    {v.submitted_by && (
                      <span className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                        {AI_ICONS[v.submitted_by] ?? "🤖"} {v.submitted_by}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">
                    {new Date(v.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                <button
                  onClick={() => setViewingCode(viewingCode?.agent_id === v.agent_id ? null : v)}
                  className="shrink-0 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-400 hover:text-white transition-colors"
                >
                  {viewingCode?.agent_id === v.agent_id ? "收起" : "查看代码"}
                </button>
              </div>
            ))}
            {viewingCode && (
              <div className="border-t border-zinc-800">
                <MonacoEditor
                  height={300}
                  language="javascript"
                  theme="vs-dark"
                  value={viewingCode.code}
                  options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, lineNumbers: "on" }}
                />
              </div>
            )}
          </div>
        )}

        {/* 对战历史 */}
        {bottomTab === "history" && (
        <div className="divide-y divide-zinc-800">
          {tank.battles.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-600">暂无 PvP 对战记录</p>
          ) : tank.battles.map(battle => {
            const won = battle.winner === tank.agent_name
            return (
              <div key={battle.id} className="flex items-center gap-4 px-4 py-3">
                {/* W/L 指示 */}
                <div className={`relative flex size-12 shrink-0 flex-col items-center justify-center rounded border-2 text-xs font-bold ${won ? "border-blue-600 text-blue-400" : "border-zinc-700 text-zinc-500"}`}>
                  <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${won ? "bg-blue-600" : "bg-zinc-700"}`} />
                  <span className="text-base font-black">{won ? "W" : "L"}</span>
                  <span className="text-[10px] leading-none">{won ? "WIN" : "LOSS"}</span>
                </div>

                {/* 对阵信息 */}
                <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-bold uppercase tracking-wide text-zinc-200">
                    {battle.challenger.toUpperCase()} VS {battle.opponent.toUpperCase()}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {battle.total_ticks} 回合 · {new Date(battle.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>

                {/* 观战按钮 */}
                <Link
                  href={`/replay/${battle.id}`}
                  className="shrink-0 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-400 hover:text-white transition-colors"
                >
                  观看回放
                </Link>
              </div>
            )
          })}
        </div>
        )}

      </div>

      {/* ── Manage 模态框 ── */}
      {manageOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setManageOpen(false) }}
        >
          <div
            ref={manageRef}
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
          >
            {/* 模态头部 */}
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
              <div className="flex items-center gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-600 bg-zinc-800">
                  <Shield className="size-6 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">管理坦克</h2>
                  <p className="text-sm text-zinc-500">在此调整策略、个人资料、技能与外观。</p>
                </div>
              </div>
              <button
                onClick={() => setManageOpen(false)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors"
              >
                关闭
              </button>
            </div>

            {/* 当前坦克信息行 */}
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-800/40 px-5 py-3">
              <div>
                <p className="text-xs text-zinc-500">当前坦克</p>
                <p className="font-bold text-white">{tank.agent_name}</p>
              </div>
            </div>

            {/* 内容区 Tab 栏 */}
            <div className="flex border-b border-zinc-800">
              {(["profile", "skill", "appearance"] as const).map((t) => {
                const labels = { profile: "个人资料", skill: "技能", appearance: "外观" }
                return (
                  <button
                    key={t}
                    onClick={() => setManageTab(t)}
                    className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 ${
                      manageTab === t
                        ? "border-blue-500 text-white"
                        : "border-transparent text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {labels[t]}
                  </button>
                )
              })}
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-y-auto p-5">

              {/* 个人资料 Tab */}
              {manageTab === "profile" && (
                <div className="flex flex-col gap-5">
                  <div>
                    <p className="mb-2 text-sm font-semibold text-zinc-300">重命名坦克</p>
                    <p className="mb-3 text-xs text-zinc-500">更改名称后，排行榜和对战历史中的显示名称将同步更新。</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={renameTo}
                        onChange={e => { setRenameTo(e.target.value); setRenameOk(false); setRenameError(null) }}
                        placeholder={tank.agent_name}
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleRename}
                        disabled={renaming || renameTo.trim() === tank.agent_name || !renameTo.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
                      >
                        {renaming ? <Loader2 className="size-3.5 animate-spin" /> : "保存"}
                      </button>
                    </div>
                    {renameError && <p className="mt-2 text-xs text-red-400">{renameError}</p>}
                    {renameOk && <p className="mt-2 text-xs text-green-400">重命名成功</p>}
                  </div>
                </div>
              )}

              {/* 技能 Tab */}
              {manageTab === "skill" && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="text-4xl">⚡</div>
                  <p className="text-sm font-semibold text-zinc-300">技能系统</p>
                  <p className="text-xs text-zinc-500">技能功能即将上线，敬请期待。</p>
                </div>
              )}

              {/* 外观 Tab */}
              {manageTab === "appearance" && (
                <div className="flex flex-col gap-5">

                  {/* AI 生成 */}
                  {isOwner && (
                    <div>
                      <p className="mb-1 text-sm font-semibold text-zinc-300">AI 生成坦克皮肤</p>
                      <p className="mb-3 text-xs text-zinc-500">用自然语言描述你想要的坦克外观，DeepSeek 将生成专属 SVG 皮肤。</p>
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={skinDesc}
                          onChange={e => setSkinDesc(e.target.value)}
                          placeholder="例如：一辆重型工业风坦克，有厚装甲板和宽履带，深灰色涂装，带红色警戒线…"
                          rows={3}
                          className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={generateSkin}
                          disabled={skinGenerating || !skinDesc.trim()}
                          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
                        >
                          {skinGenerating
                            ? <><Loader2 className="size-4 animate-spin" />生成中…</>
                            : "✨ AI 生成"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 子弹皮肤 */}
                  {isOwner && (
                    <div>
                      <p className="mb-1 text-sm font-semibold text-zinc-300">子弹样式</p>
                      <p className="mb-3 text-xs text-zinc-500">选择你的坦克在对战回放中发射的弹丸外观。</p>
                      <div className="grid grid-cols-5 gap-2">
                        {BULLET_STYLES.map(s => {
                          const active = (skin.bullet_style ?? "default") === s.value
                          return (
                            <button
                              key={s.value}
                              onClick={() => setSkin(prev => ({ ...prev, bullet_style: s.value }))}
                              className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-colors ${
                                active ? "border-blue-500 bg-blue-950/40" : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-500"
                              }`}
                            >
                              <svg viewBox="-10 -10 20 20" width="32" height="32">
                                {s.shape === "diamond" && (
                                  <polygon points="0,-7 7,0 0,7 -7,0" fill={s.color} opacity="0.9" />
                                )}
                                {s.shape === "star" && (
                                  <polygon points="0,-7 1.7,-2.3 6.7,-2.2 2.8,0.9 4.1,6 0,3.1 -4.1,6 -2.8,0.9 -6.7,-2.2 -1.7,-2.3" fill={s.color} opacity="0.9" />
                                )}
                                {s.shape === "circle" && (
                                  <>
                                    {s.value !== "default" && <circle cx="0" cy="0" r="7" fill={s.color} opacity="0.2" />}
                                    <circle cx="0" cy="0" r="4" fill={s.color} />
                                  </>
                                )}
                              </svg>
                              <span className="text-[11px] text-zinc-400">{s.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 射击效果预览 */}
                  {isOwner && (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-zinc-300">射击效果预览</p>
                      <BulletFirePreview
                        bulletStyle={skin.bullet_style ?? "default"}
                        skinSvg={skin.svg}
                      />
                    </div>
                  )}

                  {/* 坦克皮肤预览 */}
                  {skin.svg && (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-zinc-300">当前皮肤预览</p>
                      {skin.description && (
                        <p className="mb-2 text-xs text-zinc-500 italic">"{skin.description}"</p>
                      )}
                      <div className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 p-4">
                        <svg
                          viewBox="-20 -14 40 28"
                          width="200"
                          height="140"
                          dangerouslySetInnerHTML={{ __html: skin.svg }}
                        />
                      </div>
                    </div>
                  )}

                  {!skin.svg && !skinGenerating && (
                    <div className="flex flex-col items-center gap-2 py-6 text-center text-zinc-600">
                      <span className="text-3xl">🎨</span>
                      <p className="text-sm">还没有皮肤，用 AI 生成一个吧</p>
                    </div>
                  )}

                  {skinError && <p className="rounded-lg bg-red-950 px-3 py-2 text-xs text-red-400">{skinError}</p>}
                </div>
              )}
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-5 py-4">
              {skinError && <p className="mr-auto text-xs text-red-400">{skinError}</p>}
              {skinSaved && !skinGenerating && !skinSaving && <p className="mr-auto text-xs text-green-400">✓ 已保存</p>}
              <button
                onClick={() => setManageOpen(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
              >
                关闭
              </button>
              {manageTab === "appearance" && isOwner && (
                <button
                  onClick={saveSkin}
                  disabled={skinSaving}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {skinSaving ? <><Loader2 className="size-3.5 animate-spin" />保存中…</> : "保存外观"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {shareModal}

    </main>
  )
}
