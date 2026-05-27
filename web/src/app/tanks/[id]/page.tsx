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
  current_version: number
  battles: Battle[]
  skill_type: string
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
  notes: string | null
  created_at: string
}

interface TankSkin {
  svg?: string
  description?: string
  bullet_style?: string
}

const SKILLS = [
  { key: "shield",   emoji: "🛡", name: "护盾",   desc: "激活护盾，可抵挡 1 发子弹（3 帧有效窗口）",           cd: 32, color: "#00F5D4" },
  { key: "freeze",   emoji: "❄",  name: "冻结",   desc: "冻结最近敌人 2 帧，使其命令暂停出队",                 cd: 34, color: "#67e8f9" },
  { key: "stun",     emoji: "⚡", name: "眩晕",   desc: "眩晕最近敌人 6 帧，使其命令被随机替换为移动/转向",     cd: 31, color: "#FFE600" },
  { key: "overload", emoji: "🔥", name: "过载",   desc: "下次开炮发射双弹，造成双倍伤害",                     cd: 32, color: "#FF6B35" },
  { key: "cloak",    emoji: "👁", name: "隐身",   desc: "隐身 8 帧，从敌方传感器中消失",                     cd: 32, color: "#7B2FFF" },
  { key: "poison",   emoji: "🧪", name: "中毒",   desc: "使最近敌人中毒 4 帧，行动效率降低（每隔帧跳过命令）", cd: 34, color: "#22c55e" },
  { key: "teleport", emoji: "🌀", name: "传送",   desc: "瞬移至指定坐标；落点距敌 ≤ 4 格时锁炮 2 帧",        cd: 40, color: "#FF3AF2" },
  { key: "boost",    emoji: "🚀", name: "加速",   desc: "加速 6 帧，每次移动前进 2 格",                     cd: 31, color: "#fbbf24" },
] as const

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
  Cursor:  <img src="/ai-icons/cursor.ico"  width={14} height={14} className="inline-block rounded-sm" alt="Cursor" />,
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

function TankAvatar({ name, skin, size = "md" }: { name: string; skin?: TankSkin; size?: "sm" | "md" | "lg" }) {
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  const sizeClasses = {
    sm: "size-16 text-xl",
    md: "size-24 text-2xl",
    lg: "size-40 text-4xl",
  }
  const svgSizes = {
    sm: { w: 56, h: 40 },
    md: { w: 88, h: 62 },
    lg: { w: 148, h: 104 },
  }
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center border-4 border-black font-black text-black shadow-[6px_6px_0px_0px_#000] overflow-hidden ${sizeClasses[size]}`}
      style={{ background: `hsl(${hue},55%,${skin?.svg ? 20 : 65}%)` }}
    >
      {skin?.svg ? (
        <svg
          viewBox="-20 -14 40 28"
          width={svgSizes[size].w}
          height={svgSizes[size].h}
          dangerouslySetInnerHTML={{ __html: skin.svg }}
        />
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
    <div className="overflow-hidden border-4 border-black shadow-[4px_4px_0px_0px_#000]">
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
          <linearGradient id="fade-r-sky" x1="0" x2="1">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="fade-r-ground" x1="0" x2="1">
            <stop offset="0%"   stopColor="#18181b" stopOpacity="0" />
            <stop offset="100%" stopColor="#18181b" stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x="200" y="0"  width="80" height="54" fill="url(#fade-r-sky)" />
        <rect x="200" y="54" width="80" height="18" fill="url(#fade-r-ground)" />
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
    <button
      onClick={copy}
      className="border-2 border-black p-1.5 hover:bg-[#FFD93D] shadow-[2px_2px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
    >
      {copied
        ? <Check className="size-4 text-white" />
        : <Copy className="size-4 text-white" />}
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
  const [ownedBullets, setOwnedBullets] = useState<Set<string>>(new Set(["default"]))

  // 分享弹窗
  const [shareOpen, setShareOpen] = useState(false)
  const [challenging, setChallenging] = useState(false)
  const [challengeError, setChallengeError] = useState<string | null>(null)

  const isOwner = tank ? tank.owner === (getCookie("username") ?? "") : false

  async function handleChallenge() {
    if (!tank) return
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    setChallenging(true)
    setChallengeError(null)
    try {
      const res  = await fetch(`${apiBase}/api/challenge/${tank.agent_id}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "挑战失败")
      router.push(`/replay/${data.id}`)
    } catch (err) {
      setChallengeError(err instanceof Error ? err.message : "挑战失败")
      setChallenging(false)
    }
  }

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

  async function loadShopInventory() {
    const token = getCookie("token")
    if (!token) return
    const res = await fetch(`${apiBase}/api/shop/inventory`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    const owned = new Set<string>(["default"])
    for (const item of (data.items ?? []) as { item_type: string; item_id: string }[]) {
      if (item.item_type === "bullet") owned.add(item.item_id)
    }
    setOwnedBullets(owned)
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
      if (!res.ok) return
      setSkinSaved(true)
      // 同步商店 equipped 状态
      const bulletId = skin.bullet_style ?? "default"
      await fetch(`${apiBase}/api/shop/equip`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_type: "bullet", item_id: bulletId }),
      })
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
      if (isOwner) { loadKey(); loadVersions(); loadShopInventory() }
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
    <main
      className="flex flex-1 items-center justify-center bg-[#FFFDF5] text-black"
      style={{ backgroundImage: "radial-gradient(#00000012 1px, transparent 1px)", backgroundSize: "24px 24px" }}
    >
      <div className="border-4 border-black bg-white p-10 shadow-[8px_8px_0px_0px_#000]">
        <Loader2 className="size-8 animate-spin" />
      </div>
    </main>
  )

  if (error || !tank) return (
    <main
      className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 bg-[#FFFDF5] text-black"
      style={{ backgroundImage: "radial-gradient(#00000012 1px, transparent 1px)", backgroundSize: "24px 24px" }}
    >
      <Link
        href="/tanks"
        className="inline-flex items-center gap-1.5 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
      >
        <ArrowLeft className="size-4 stroke-[3px]" /> 返回
      </Link>
      <p className="mt-4 border-4 border-black bg-[#FF6B6B] px-4 py-3 text-white font-black shadow-[4px_4px_0px_0px_#000]">
        {error ?? "坦克不存在"}
      </p>
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
      <div className="flex w-full max-w-md flex-col overflow-hidden border-4 border-black bg-[#FFFDF5] shadow-[12px_12px_0px_0px_#000]">
        {/* 黄色头部 */}
        <div className="flex items-start justify-between gap-4 border-b-4 border-black bg-[#FFD93D] p-5">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight">分享坦克</h2>
            <p className="mt-1 text-sm font-bold text-black/70">把链接发给朋友，围观或发起挑战</p>
          </div>
          <button
            onClick={() => setShareOpen(false)}
            className="border-4 border-black bg-white p-1.5 shadow-[3px_3px_0px_0px_#000] hover:bg-black hover:text-white active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
            aria-label="关闭"
          >
            <X className="size-4 stroke-[3px]" />
          </button>
        </div>

        {/* 坦克行 */}
        <div className="flex items-center gap-4 border-b-4 border-black bg-white p-5">
          <TankAvatar name={tank.agent_name} skin={skin} size="sm" />
          <div>
            <p className="text-2xl font-black uppercase leading-tight">{tank.agent_name}</p>
            <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color: rank.color }}>
              <Shield className="size-3.5 stroke-[3px]" /> {rank.tier} {rank.division}
            </div>
            <p className="text-xs font-bold text-black/60">{tank.pvp_wins}胜 · {tank.pvp_losses}负 · 胜率 {winRate}%</p>
          </div>
        </div>

        {/* URL */}
        <div className="p-5">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest">分享链接</p>
          <div className="flex items-center border-4 border-black bg-white shadow-[4px_4px_0px_0px_#000]">
            <input
              type="text"
              readOnly
              value={shareUrl}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 truncate bg-transparent px-3 py-2 font-mono text-xs focus:outline-none"
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
      <main
        className="flex-1 bg-[#FFFDF5] text-black"
        style={{ backgroundImage: "radial-gradient(#00000012 1px, transparent 1px)", backgroundSize: "24px 24px" }}
      >
        <div className="mx-auto w-full max-w-4xl px-4 py-8 flex flex-col gap-6">

          <div className="flex items-center justify-between">
            <Link
              href="/tanks"
              className="inline-flex items-center gap-1.5 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
            >
              <ArrowLeft className="size-4 stroke-[3px]" /> 返回坦克库
            </Link>
          </div>

          {/* 头部信息区 */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* 左侧：名称 + 成就 + 统计 + 按钮 */}
            <div className="flex flex-col gap-4 flex-1 min-w-0">
              <div>
                <h1 className="text-7xl sm:text-8xl font-black uppercase tracking-tight leading-none break-all">{tank.agent_name}</h1>
                <div className="mt-2 flex items-center gap-3">
                  <p className="text-sm font-bold text-black/60">拥有者：{tank.owner}</p>
                  <span className="border-2 border-black bg-[#FFD93D] px-2 py-0.5 text-xs font-black shadow-[2px_2px_0px_0px_#000]">
                    V{tank.current_version}
                  </span>
                </div>
              </div>

              {/* 成就标签 */}
              {achievements.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {achievements.map((a, i) => (
                    <span
                      key={a.label}
                      title={a.desc}
                      className={`inline-flex items-center gap-1 border-2 border-black bg-[#FFD93D] px-2.5 py-1 text-xs font-black shadow-[2px_2px_0px_0px_#000] ${i % 2 === 0 ? "rotate-1" : "-rotate-1"}`}
                    >
                      {a.icon} {a.label}
                    </span>
                  ))}
                </div>
              )}

              {/* 统计网格 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-0 border-4 border-black shadow-[6px_6px_0px_0px_#000]">
                {[
                  ["RANK",    `${rank.tier} ${rank.division}`, rank.color, true],
                  ["SCORE",   rank.score.toString(),           rank.color, true],
                  ["RECORD",  `${tank.pvp_wins}-${tank.pvp_losses}-0`, rank.color, true],
                  ["WIN RATE",`${winRate}%`,                   "#1a1a1a", false],
                  ["BATTLES", tank.pvp_battles.toString(),     "#1a1a1a", false],
                  ["STATUS",  "活跃",                           "#1a1a1a", false],
                ].map(([label, value, bg, isDark]) => (
                  <div
                    key={label as string}
                    className="flex flex-col gap-1 px-4 py-3 border-r-4 border-b-4 border-black last:border-r-0 [&:nth-child(3)]:border-r-0 sm:[&:nth-child(3)]:border-r-4 sm:[&:nth-child(6)]:border-r-0"
                    style={{ backgroundColor: bg as string }}
                  >
                    <p className={`text-[10px] font-black uppercase tracking-widest ${isDark ? "text-black/60" : "text-white/50"}`}>{label as string}</p>
                    <p className={`text-xl font-black ${isDark ? "text-black" : "text-white"}`}>{value as string}</p>
                  </div>
                ))}
              </div>

              {/* 操作按钮 */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleChallenge}
                  disabled={challenging}
                  className="flex w-full sm:w-auto items-center justify-center gap-2 border-4 border-black bg-[#FF6B6B] px-6 py-3 text-sm font-black uppercase text-white shadow-[6px_6px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[8px_8px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[6px_6px_0px_0px_#000]"
                >
                  {challenging
                    ? <><Loader2 className="size-4 stroke-[3px] animate-spin" /> 准备中…</>
                    : <><Swords className="size-4 stroke-[3px]" /> CHALLENGE 挑战此坦克 →</>}
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex w-full sm:w-auto items-center justify-center gap-2 border-4 border-black bg-white px-5 py-3 text-sm font-black uppercase shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                >
                  <Share2 className="size-4 stroke-[3px]" /> 分享
                </button>
              </div>
              {challengeError && (
                <p className="mt-2 border-4 border-[#FF6B6B] bg-[#FF6B6B]/10 px-3 py-2 text-sm font-black text-[#FF6B6B]">
                  {challengeError}
                </p>
              )}
            </div>

            {/* 右侧：大头像 + rank badge */}
            <div className="flex shrink-0 flex-col items-center gap-3">
              <TankAvatar name={tank.agent_name} skin={skin} size="lg" />
              <div
                className="flex items-center gap-1.5 rounded-full border-4 border-black bg-white px-3 py-1 text-xs font-black shadow-[3px_3px_0px_0px_#000]"
                style={{ color: rank.color }}
              >
                <Shield className="size-3.5 stroke-[3px]" /> {rank.tier} {rank.division}
              </div>
            </div>
          </div>

          {/* Recent Battles 面板 */}
          <div className="border-4 border-black shadow-[8px_8px_0px_0px_#000] overflow-hidden">
            <div className="bg-black text-white px-5 py-3">
              <span className="text-sm font-black uppercase tracking-widest">Recent Battles</span>
            </div>

            <div className="divide-y-4 divide-black">
              {tank.battles.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm font-bold text-black/50">暂无 PvP 对战记录</p>
              ) : tank.battles.map(battle => {
                const won = battle.winner === tank.agent_name
                return (
                  <div key={battle.id} className="flex items-center gap-4 px-5 py-4 bg-white">
                    {/* WIN/LOSS 方块 */}
                    <div className={`relative flex size-12 shrink-0 flex-col items-center justify-center border-4 border-black font-black shadow-[3px_3px_0px_0px_#000] ${won ? "bg-[#00C853] text-white" : "bg-[#FF3D00] text-white"}`}>
                      <span className="text-[9px] font-black tracking-widest opacity-80 leading-none">{won ? "WIN" : "LOSS"}</span>
                      <span className="text-xl leading-tight">{won ? "★" : "✕"}</span>
                    </div>
                    {/* 对阵信息 */}
                    <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap text-sm font-black uppercase tracking-wide">
                        {[battle.challenger, battle.opponent].map((name, i) => {
                          const isMe = name === tank.agent_name
                          return (
                            <React.Fragment key={i}>
                              {i === 1 && <span className="text-black/30 font-bold text-xs">VS</span>}
                              <span className={isMe
                                ? "border-2 border-black bg-[#FFE600] px-1.5 py-0.5 text-xs leading-none"
                                : "text-black/70"
                              }>
                                {name.toUpperCase()}
                              </span>
                            </React.Fragment>
                          )
                        })}
                      </div>
                      <span className="text-xs font-bold text-black/50">
                        {battle.total_ticks} 回合 · {new Date(battle.created_at).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <Link
                      href={`/replay/${battle.id}`}
                      className="shrink-0 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
                    >
                      观看回放
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
    <main
      className="flex-1 bg-[#FFFDF5] text-black"
      style={{ backgroundImage: "radial-gradient(#00000012 1px, transparent 1px)", backgroundSize: "24px 24px" }}
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-6 flex flex-col gap-6">

        {/* ── 顶部操作栏 ── */}
        <div className="flex items-center justify-between">
          <Link
            href="/tanks"
            className="flex items-center gap-1.5 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
          >
            <ArrowLeft className="size-4 stroke-[3px]" /> 返回坦克库
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
            >
              <Share2 className="size-4 stroke-[3px]" /> 分享坦克
            </button>
            <button
              onClick={handleChallenge}
              disabled={challenging}
              className="flex items-center gap-1.5 border-4 border-black bg-[#FF6B6B] px-3 py-1.5 text-sm font-black text-white uppercase shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {challenging
                ? <><Loader2 className="size-4 animate-spin" /> 准备中…</>
                : <><Swords className="size-4 stroke-[3px]" /> 挑战此坦克</>}
            </button>
          </div>
        </div>

        {/* ── 标题区 ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-5xl font-black uppercase tracking-tight leading-none">{tank.agent_name}</h1>
              <span className="border-2 border-black bg-[#FFD93D] px-2 py-0.5 text-sm font-black shadow-[2px_2px_0px_0px_#000]">
                V{tank.current_version}
              </span>
            </div>
            <p className="text-sm font-bold text-black/60">当前对战记录：{tank.pvp_wins} 胜 · {tank.pvp_losses} 负</p>
            {achievements.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {achievements.map((a, i) => (
                  <span
                    key={a.label}
                    title={a.desc}
                    className={`inline-flex items-center gap-1 border-2 border-black bg-[#FFD93D] px-2.5 py-1 text-xs font-black shadow-[2px_2px_0px_0px_#000] cursor-default ${i % 2 === 0 ? "rotate-1" : "-rotate-1"}`}
                  >
                    <span>{a.icon}</span>{a.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <TankAvatar name={tank.agent_name} skin={skin} size="md" />
        </div>

        {/* ── 两列布局 ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">

          {/* 左：概况 */}
          <div className="flex flex-col gap-4">

            {/* 段位卡 */}
            <div className="border-4 border-black bg-[#C4B5FD] p-4 shadow-[6px_6px_0px_0px_#000]">
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-black/60">段位</p>
              <div className="flex items-center gap-2">
                <Shield className="size-5 stroke-[3px]" style={{ color: rank.color }} />
                <span className="text-xl font-black">{rank.tier} {rank.division}</span>
              </div>
              <div className="mt-3 border-2 border-black h-4 bg-white overflow-hidden">
                <div
                  className="h-full bg-[#FFD93D] transition-all"
                  style={{ width: `${rank.progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs font-bold text-black/60">{rank.progress}/100</p>
            </div>

            {/* 统计表 */}
            <div className="border-4 border-black bg-white shadow-[4px_4px_0px_0px_#000] divide-y-4 divide-black">
              {[
                ["积分", rank.score.toString()],
                ["胜率", `${winRate}%`],
                ["战绩", `${tank.pvp_wins}-${tank.pvp_losses}-0`],
                ["状态", "活跃"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-4 py-3">
                  <span className="font-bold text-black/60">{label}</span>
                  <span className="font-black">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 右：Agent Access / 代码编辑器 */}
          <div className="flex flex-col gap-3">
            {/* 标签栏 */}
            <div className="border-4 border-black bg-white shadow-[6px_6px_0px_0px_#000]">
              <div className="border-b-4 border-black flex items-center">
                <div className="flex flex-1">
                  <button
                    onClick={() => setRightTab("access")}
                    className={`px-5 py-3 text-sm transition-colors ${rightTab === "access" ? "border-b-4 border-black bg-[#FFD93D] font-black" : "font-bold text-black/50 hover:text-black"}`}
                  >
                    Agent Access
                  </button>
                  <button
                    onClick={() => setRightTab("code")}
                    className={`px-5 py-3 text-sm transition-colors ${rightTab === "code" ? "border-b-4 border-black bg-[#FFD93D] font-black" : "font-bold text-black/50 hover:text-black"}`}
                  >
                    代码编辑器
                  </button>
                </div>
                {/* 右侧操作按钮 */}
                <div className="flex items-center gap-2 px-3">
                  {isOwner && (
                    <button
                      onClick={() => { setManageOpen(true); setRenameTo(tank.agent_name) }}
                      className="flex items-center gap-1.5 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
                    >
                      <Settings className="size-3.5 stroke-[3px]" /> 管理
                    </button>
                  )}
                  {rightTab === "code" && isOwner && (
                    <>
                      <select
                        value={submittedBy}
                        onChange={e => setSubmittedBy(e.target.value)}
                        className="border-4 border-black bg-white px-2 py-1.5 text-sm font-bold focus:outline-none"
                      >
                        {AI_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex items-center gap-1.5 border-4 border-black bg-[#FF6B6B] px-3 py-1.5 text-sm font-black uppercase text-white shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-60 transition-all duration-100"
                      >
                        {submitting ? <><Loader2 className="size-3.5 animate-spin" />测试中...</> : "提交更新"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Agent Access 内容 */}
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
   读取当前代码、战绩、Elo。
2. 分析现有代码与对战记录，提出改进策略。
3. POST ${apiBase}/api/agent/tank/simulate
   用草稿代码做镜像自战（不计入战绩，用于验证代码不崩溃、基本逻辑正确）。
   body: { "code": "..." }
4. POST ${apiBase}/api/agent/tank/code
   发布新版本。body: { "code": "...", "notes": "改动说明", "submittedBy": "Claude | ChatGPT | Gemini | DeepSeek | Qwen | Grok | Cursor | Copilot" }
5. POST ${apiBase}/api/agent/tank/challenge
   挑战其他玩家坦克，战绩计入排行榜。body: { "randomOpponent": true }
   或指定对手：body: { "opponentTankId": "<agent_id>" }

【运行时合约简要】
- 入口：function onIdle(me, enemy, game) { ... }
- 命令逐帧执行：me.go(n) / me.turn("left"|"right") / me.fire() / print(msg)
- 地图 20×20 格，4 向（north/east/south/west），子弹伤害 25，射击冷却 3 回合，最大 300 回合
- 坐标用 [col, row]，访问地图：game.map[row][col]；地图字符 'x' 永久墙 / 'm' 可破坏土堆 / 'o' 草丛 / '.' 地板
- enemy 可能为 null，必须做空值检查
- 仅支持纯 ES5，禁用 fetch/setTimeout/require，单次执行上限 10ms，内存 2MB

请先调用 GET ${apiBase}/api/agent/tank 读取上下文，并打印出当前代码与战绩，然后再开始迭代。`

                return (
                  <div className="p-5 flex flex-col gap-4">
                    <div>
                      <h3 className="text-base font-black uppercase tracking-tight">Agent Access</h3>
                      <p className="mt-1 text-sm font-bold text-black/60">使用 Tank Key 让你的 Agent 读取、测试和更新这个坦克。下方的「完整 Prompt」可直接复制粘贴给任意 AI 助手。</p>
                    </div>

                    {/* 完整 Prompt */}
                    <div className="border-4 border-black overflow-hidden shadow-[4px_4px_0px_0px_#000]">
                      <div className="bg-black px-3 py-1.5 flex items-center justify-between">
                        <span className="text-[#FFD93D] text-xs font-black uppercase tracking-widest">完整 PROMPT · 复制后直接发给 AI</span>
                        <CopyButton text={fullPrompt} />
                      </div>
                      <pre className="bg-zinc-900 px-3 py-2.5 font-mono text-[11px] text-zinc-300 max-h-72 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
                        {fullPrompt}
                      </pre>
                    </div>

                    <div className="flex flex-col gap-3">
                      {/* Tank Key */}
                      <div className="border-4 border-black overflow-hidden shadow-[4px_4px_0px_0px_#000]">
                        <div className="bg-black px-3 py-1.5 flex items-center justify-between">
                          <span className="text-[#FFD93D] text-xs font-black uppercase tracking-widest">TANK KEY</span>
                          <div className="flex items-center gap-2">
                            {apiKey && <CopyButton text={apiKey.key} />}
                            {isOwner && (
                              <button
                                onClick={generateKey}
                                disabled={generatingKey}
                                className="border-2 border-[#FFD93D] px-2 py-0.5 text-[11px] text-[#FFD93D] font-bold hover:bg-[#FFD93D] hover:text-black disabled:opacity-40 transition-colors"
                              >
                                {generatingKey ? <Loader2 className="size-3 animate-spin" /> : "轮换密钥"}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-white px-3 py-2">
                          {apiKey ? (
                            <>
                              <code className="flex-1 truncate font-mono text-xs text-black font-bold">{apiKey.key}</code>
                            </>
                          ) : keyLoaded ? (
                            <span className="flex-1 text-xs font-bold text-black/40">未生成</span>
                          ) : (
                            <span className="flex-1 flex items-center gap-1.5 text-xs font-bold text-black/40">
                              <Loader2 className="size-3 animate-spin" /> 加载中…
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Guide */}
                      <div className="border-4 border-black overflow-hidden shadow-[4px_4px_0px_0px_#000]">
                        <div className="bg-black px-3 py-1.5 flex items-center justify-between">
                          <span className="text-[#FFD93D] text-xs font-black uppercase tracking-widest">GUIDE</span>
                          <CopyButton text={guideUrl} />
                        </div>
                        <div className="flex items-center gap-2 bg-white px-3 py-2">
                          <span className="flex-1 truncate font-mono text-xs font-bold">{guideUrl}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* 代码编辑器内容 */}
              {rightTab === "code" && (
                <div className="flex flex-col gap-0">
                  <div className="border-4 border-black shadow-[4px_4px_0px_0px_#000] overflow-hidden m-4 mb-0">
                    <div className="bg-black px-4 py-2 border-b-4 border-black flex justify-between items-center">
                      <span className="font-mono text-xs text-white">agent.js</span>
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
                  <div className="px-4 pt-3 pb-4 flex flex-col gap-2">
                    {submitError && (
                      <p className="border-4 border-black bg-[#FF6B6B] px-3 py-2 text-xs font-black text-white shadow-[2px_2px_0px_0px_#000]">
                        {submitError}
                      </p>
                    )}
                    {submitted && submitResults && (
                      <div className="flex flex-col gap-1.5">
                        <div className="border-4 border-black bg-[#FFD93D] px-3 py-2 text-center text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]">
                          ✓ 已更新到排行榜
                        </div>
                        {submitResults.map(r => {
                          const won = r.winner === tank.agent_name
                          return (
                            <div key={r.opponent} className="flex items-center justify-between border-4 border-black bg-white px-3 py-2 shadow-[2px_2px_0px_0px_#000]">
                              <span className="text-xs font-bold">vs {BOT_LABEL[r.opponent] ?? r.opponent}</span>
                              <div className="flex items-center gap-1.5">
                                {won
                                  ? <CheckCircle className="size-3.5 stroke-[3px]" style={{ color: "#16a34a" }} />
                                  : <XCircle className="size-3.5 stroke-[3px]" style={{ color: "#dc2626" }} />}
                                <span className={`text-xs font-black ${won ? "text-green-600" : "text-red-600"}`}>{won ? "胜" : "负"}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 底部标签面板 ── */}
        <div className="border-4 border-black shadow-[8px_8px_0px_0px_#000] overflow-hidden bg-white">
          <div className="border-b-4 border-black flex">
            <button
              onClick={() => { setBottomTab("versions"); loadVersions() }}
              className={`flex-1 py-3 text-sm font-black uppercase tracking-widest transition-colors ${
                bottomTab === "versions" ? "bg-[#FFD93D] border-b-4 border-black" : "text-black/50 hover:text-black hover:bg-white"
              }`}
            >
              版本记录（{versionsLoaded ? versions.length : "…"}）
            </button>
            <button
              onClick={() => setBottomTab("history")}
              className={`flex-1 py-3 text-sm font-black uppercase tracking-widest transition-colors border-l-4 border-black ${
                bottomTab === "history" ? "bg-[#FFD93D] border-b-4 border-black" : "text-black/50 hover:text-black hover:bg-white"
              }`}
            >
              对战历史（{tank.battles.length}{tank.battles.length >= 10 ? "+" : ""}）
            </button>
          </div>

          {/* 版本记录 */}
          {bottomTab === "versions" && (
            <div className="max-h-[400px] overflow-y-auto divide-y-4 divide-black">
              {versionsLoading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-black/50">
                  <Loader2 className="size-4 animate-spin" /> 加载中...
                </div>
              )}
              {!versionsLoading && versions.length === 0 && (
                <p className="py-12 text-center text-sm font-bold text-black/40">暂无版本记录</p>
              )}
              {versions.map((v) => (
                <div key={v.agent_id} className="border-b-4 border-black px-4 py-4 flex items-start gap-4">
                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-2xl">V{v.version}</span>
                      {v.submitted_by && (
                        <span className="flex items-center gap-1 border-2 border-black bg-[#C4B5FD] px-1.5 py-0.5 text-xs font-black">
                          {AI_ICONS[v.submitted_by] ?? "🤖"} {v.submitted_by}
                        </span>
                      )}
                    </div>
                    {v.notes && (
                      <p className="text-sm font-bold text-black/80 leading-snug line-clamp-2">{v.notes}</p>
                    )}
                    <span className="text-xs font-bold text-black/50">
                      {new Date(v.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <button
                    onClick={() => setViewingCode(v)}
                    className="shrink-0 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
                  >
                    查看代码
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 对战历史 */}
          {bottomTab === "history" && (
            <div className="max-h-[400px] overflow-y-auto divide-y-4 divide-black">
              {tank.battles.length === 0 ? (
                <p className="py-12 text-center text-sm font-bold text-black/40">暂无 PvP 对战记录</p>
              ) : tank.battles.map(battle => {
                const won = battle.winner === tank.agent_name
                return (
                  <div key={battle.id} className="border-b-4 border-black px-4 py-4 flex items-center gap-4">
                    {/* W/L 方块 */}
                    <div className={`relative flex size-12 shrink-0 flex-col items-center justify-center border-4 border-black font-black shadow-[3px_3px_0px_0px_#000] ${won ? "bg-[#00C853] text-white" : "bg-[#FF3D00] text-white"}`}>
                      <span className="text-[10px] font-black tracking-widest opacity-80 leading-none">{won ? "WIN" : "LOSS"}</span>
                      <span className="text-xl leading-tight">{won ? "★" : "✕"}</span>
                    </div>

                    {/* 对阵信息 */}
                    <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap text-sm font-black uppercase tracking-wide">
                        {[battle.challenger, battle.opponent].map((name, i) => {
                          const isMe = name === tank.agent_name
                          return (
                            <React.Fragment key={i}>
                              {i === 1 && <span className="text-black/30 font-bold text-xs">VS</span>}
                              <span className={isMe
                                ? "border-2 border-black bg-[#FFE600] px-1.5 py-0.5 text-xs leading-none"
                                : "text-black/70"
                              }>
                                {name.toUpperCase()}
                              </span>
                            </React.Fragment>
                          )
                        })}
                      </div>
                      <span className="text-xs font-bold text-black/50">
                        {battle.total_ticks} 回合 · {new Date(battle.created_at).toLocaleString("zh-CN")}
                      </span>
                    </div>

                    {/* 观战按钮 */}
                    <Link
                      href={`/replay/${battle.id}`}
                      className="shrink-0 border-4 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
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
              className="flex w-full max-w-2xl flex-col overflow-hidden border-4 border-black bg-[#FFFDF5] shadow-[16px_16px_0px_0px_#000] max-h-[90vh]"
            >
              {/* 模态头部 */}
              <div className="flex items-start justify-between gap-4 border-b-4 border-black bg-[#C4B5FD] p-5">
                <div className="flex items-center gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center border-4 border-black bg-white shadow-[3px_3px_0px_0px_#000]">
                    <Shield className="size-6 stroke-[3px]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tight">管理坦克</h2>
                    <p className="text-sm font-bold text-black/60">在此调整策略、个人资料、技能与外观。</p>
                  </div>
                </div>
                <button
                  onClick={() => setManageOpen(false)}
                  className="border-4 border-black bg-white p-1.5 shadow-[3px_3px_0px_0px_#000] hover:bg-black hover:text-white active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
                >
                  <X className="size-4 stroke-[3px]" />
                </button>
              </div>

              {/* 当前坦克信息行 */}
              <div className="flex items-center justify-between border-b-4 border-black bg-[#FFD93D] px-5 py-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-black/60">当前坦克</p>
                  <p className="font-black text-lg">{tank.agent_name}</p>
                </div>
              </div>

              {/* Tab 栏 */}
              <div className="flex border-b-4 border-black">
                {(["profile", "skill", "appearance"] as const).map((t) => {
                  const labels = { profile: "个人资料", skill: "技能", appearance: "外观" }
                  return (
                    <button
                      key={t}
                      onClick={() => setManageTab(t)}
                      className={`flex-1 py-3 text-sm font-black uppercase tracking-wide transition-colors ${
                        manageTab === t
                          ? "bg-[#FFD93D] border-b-4 border-black"
                          : "text-black/50 hover:text-black hover:bg-white"
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
                      <p className="mb-2 text-sm font-black uppercase tracking-wide">重命名坦克</p>
                      <p className="mb-3 text-xs font-bold text-black/60">更改名称后，排行榜和对战历史中的显示名称将同步更新。</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={renameTo}
                          onChange={e => { setRenameTo(e.target.value); setRenameOk(false); setRenameError(null) }}
                          placeholder={tank.agent_name}
                          className="flex-1 border-4 border-black bg-white px-3 py-2 font-bold focus:outline-none focus:bg-[#FFD93D] focus:shadow-[4px_4px_0px_0px_#000] transition-all"
                        />
                        <button
                          onClick={handleRename}
                          disabled={renaming || renameTo.trim() === tank.agent_name || !renameTo.trim()}
                          className="border-4 border-black bg-[#FF6B6B] text-white px-4 py-2 font-black uppercase shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 transition-all duration-100"
                        >
                          {renaming ? <Loader2 className="size-3.5 animate-spin" /> : "保存"}
                        </button>
                      </div>
                      {renameError && (
                        <p className="mt-2 border-2 border-black bg-[#FF6B6B] px-3 py-1.5 text-xs font-black text-white">{renameError}</p>
                      )}
                      {renameOk && (
                        <p className="mt-2 border-2 border-black bg-[#FFD93D] px-3 py-1.5 text-xs font-black">重命名成功</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 技能 Tab */}
                {manageTab === "skill" && (() => {
                  const sk = SKILLS.find(s => s.key === tank.skill_type) ?? SKILLS[0]
                  return (
                    <div className="flex flex-col gap-4">
                      {/* 当前技能卡 */}
                      <div
                        className="flex items-center gap-4 border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000]"
                        style={{ background: `${sk.color}18`, borderColor: sk.color }}
                      >
                        <div
                          className="flex size-14 shrink-0 items-center justify-center border-4 border-black text-3xl shadow-[3px_3px_0px_0px_#000]"
                          style={{ background: `${sk.color}30` }}
                        >
                          {sk.emoji}
                        </div>
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-black">{sk.name}</span>
                            <span
                              className="border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                              style={{ background: sk.color, color: "#000" }}
                            >
                              CD {sk.cd}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-black/60">{sk.desc}</p>
                        </div>
                      </div>

                      {/* 所有技能一览 */}
                      <p className="text-[10px] font-black uppercase tracking-widest text-black/40">所有技能</p>
                      <div className="grid grid-cols-2 gap-2">
                        {SKILLS.map(s => {
                          const active = s.key === tank.skill_type
                          return (
                            <div
                              key={s.key}
                              className="flex items-center gap-2.5 border-2 border-black px-3 py-2"
                              style={{ background: active ? `${s.color}20` : "transparent", borderColor: active ? s.color : "#00000020" }}
                            >
                              <span className="text-xl">{s.emoji}</span>
                              <div className="min-w-0">
                                <p className="text-xs font-black truncate">{s.name}</p>
                                <p className="text-[10px] text-black/40">CD {s.cd}</p>
                              </div>
                              {active && (
                                <span className="ml-auto shrink-0 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase" style={{ background: s.color }}>
                                  装备中
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* 外观 Tab */}
                {manageTab === "appearance" && (
                  <div className="flex flex-col gap-5">

                    {/* AI 生成 */}
                    {isOwner && (
                      <div>
                        <p className="mb-1 text-sm font-black uppercase tracking-wide">AI 生成坦克皮肤</p>
                        <p className="mb-3 text-xs font-bold text-black/60">用自然语言描述你想要的坦克外观，DeepSeek 将生成专属 SVG 皮肤。</p>
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={skinDesc}
                            onChange={e => setSkinDesc(e.target.value)}
                            placeholder="例如：一辆重型工业风坦克，有厚装甲板和宽履带，深灰色涂装，带红色警戒线…"
                            rows={3}
                            className="w-full resize-none border-4 border-black bg-white px-3 py-2 font-bold focus:outline-none focus:bg-[#FFD93D] focus:shadow-[4px_4px_0px_0px_#000] transition-all"
                          />
                          <button
                            onClick={generateSkin}
                            disabled={skinGenerating || !skinDesc.trim()}
                            className="flex items-center justify-center gap-2 border-4 border-black bg-[#FF6B6B] py-2 text-sm font-black uppercase text-white shadow-[4px_4px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 transition-all duration-100"
                          >
                            {skinGenerating
                              ? <><Loader2 className="size-4 animate-spin" />生成中…</>
                              : "✨ AI 生成"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 子弹样式 */}
                    {isOwner && (
                      <div>
                        <p className="mb-1 text-sm font-black uppercase tracking-wide">子弹样式</p>
                        <p className="mb-3 text-xs font-bold text-black/60">选择你的坦克在对战回放中发射的弹丸外观。</p>
                        <div className="flex flex-wrap gap-2">
                          {BULLET_STYLES.filter(s => ownedBullets.has(s.value)).map(s => {
                            const active = (skin.bullet_style ?? "default") === s.value
                            return (
                              <button
                                key={s.value}
                                onClick={() => setSkin(prev => ({ ...prev, bullet_style: s.value }))}
                                className={`flex flex-col items-center gap-1.5 border-4 border-black p-2.5 transition-colors ${
                                  active
                                    ? "bg-[#FFD93D] shadow-[3px_3px_0px_0px_#000]"
                                    : "bg-white hover:bg-[#FFF9C4] shadow-[2px_2px_0px_0px_#000]"
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
                                <span className="text-[11px] font-bold">{s.label}</span>
                              </button>
                            )
                          })}
                        </div>
                        {ownedBullets.size < BULLET_STYLES.length && (
                          <Link href="/shop" onClick={() => setManageOpen(false)}
                            className="mt-2 inline-block text-xs font-black text-black/40 underline hover:text-black transition-colors"
                          >
                            前往商店解锁更多样式 →
                          </Link>
                        )}
                      </div>
                    )}

                    {/* 射击效果预览 */}
                    {isOwner && (
                      <div>
                        <p className="mb-2 text-sm font-black uppercase tracking-wide">射击效果预览</p>
                        <BulletFirePreview
                          bulletStyle={skin.bullet_style ?? "default"}
                          skinSvg={skin.svg}
                        />
                      </div>
                    )}

                    {/* 坦克皮肤预览 */}
                    {skin.svg && (
                      <div>
                        <p className="mb-2 text-sm font-black uppercase tracking-wide">当前皮肤预览</p>
                        {skin.description && (
                          <p className="mb-2 text-xs font-bold text-black/50 italic">"{skin.description}"</p>
                        )}
                        <div className="flex items-center justify-center border-4 border-black bg-white p-4 shadow-[4px_4px_0px_0px_#000]">
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
                      <div className="flex flex-col items-center gap-2 py-6 text-center">
                        <span className="text-3xl">🎨</span>
                        <p className="text-sm font-bold text-black/50">还没有皮肤，用 AI 生成一个吧</p>
                      </div>
                    )}

                    {skinError && (
                      <p className="border-4 border-black bg-[#FF6B6B] px-3 py-2 text-xs font-black text-white shadow-[2px_2px_0px_0px_#000]">
                        {skinError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 底部操作栏 */}
              <div className="flex items-center justify-end gap-3 border-t-4 border-black px-5 py-4">
                {skinError && <p className="mr-auto text-xs font-black text-red-600">{skinError}</p>}
                {skinSaved && !skinGenerating && !skinSaving && (
                  <p className="mr-auto text-xs font-black">✓ 已保存</p>
                )}
                <button
                  onClick={() => setManageOpen(false)}
                  className="border-4 border-black bg-white px-4 py-2 text-sm font-bold shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
                >
                  关闭
                </button>
                {manageTab === "appearance" && isOwner && (
                  <button
                    onClick={saveSkin}
                    disabled={skinSaving}
                    className="flex items-center gap-1.5 border-4 border-black bg-[#FF6B6B] px-5 py-2 text-sm font-black uppercase text-white shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50 transition-all duration-100"
                  >
                    {skinSaving ? <><Loader2 className="size-3.5 animate-spin" />保存中…</> : "保存外观"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {shareModal}

      </div>

      {/* 代码查看弹窗 */}
      {viewingCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setViewingCode(null)}
        >
          <div
            className="relative flex w-full max-w-3xl flex-col border-4 border-black bg-white shadow-[8px_8px_0px_0px_#000] mx-4"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗标题栏 */}
            <div className="flex items-center justify-between border-b-4 border-black bg-[#C4B5FD] px-4 py-3">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-black text-xl">V{viewingCode.version}</span>
                  {viewingCode.submitted_by && (
                    <span className="border-2 border-black bg-white px-2 py-0.5 text-xs font-black">
                      {AI_ICONS[viewingCode.submitted_by] ?? "🤖"} {viewingCode.submitted_by}
                    </span>
                  )}
                  <span className="text-xs font-bold text-black/60">
                    {new Date(viewingCode.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                {viewingCode.notes && (
                  <p className="text-sm font-bold text-black/70 truncate">{viewingCode.notes}</p>
                )}
              </div>
              <button
                onClick={() => setViewingCode(null)}
                className="border-2 border-black bg-white p-1 shadow-[2px_2px_0px_0px_#000] hover:bg-red-100 active:shadow-none active:translate-x-px active:translate-y-px transition-all"
              >
                <X className="size-4" />
              </button>
            </div>
            <MonacoEditor
              height={480}
              language="javascript"
              theme="vs-dark"
              value={viewingCode.code}
              options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, lineNumbers: "on" }}
            />
          </div>
        </div>
      )}

    </main>
  )
}
