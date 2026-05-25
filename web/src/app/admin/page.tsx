"use client"

import { useEffect, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Shield, Users, Swords, BarChart3, Trash2, Ban, CheckCircle2, ExternalLink } from "lucide-react"
import Link from "next/link"
import { getCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── 类型定义 ─────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string
  username: string
  email: string
  is_admin: boolean
  banned: boolean
  created_at: string
  agent_count: number
}

interface AdminTank {
  agent_id: string
  name: string
  owner_username: string
  elo: number
  pvp_battles: number
  created_at: string
}

interface AdminStats {
  total_users: number
  total_agents: number
  total_battles: number
  battles_last_24h: number
}

interface RecentBattle {
  id: string
  /** 挑战方坦克名（来自 TankBattleRecord.challenger） */
  challenger: string
  opponent: string
  winner: string
  total_ticks: number
  created_at: string
}

type TabKey = "users" | "tanks" | "battles" | "stats"

// ── 辅助组件 ─────────────────────────────────────────────────────────────────

// Tab 按钮
function TabButton({
  value, current, onChange, icon: Icon, label, color,
}: {
  value: TabKey
  current: TabKey
  onChange: (v: TabKey) => void
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  color: string
}) {
  const active = current === value
  return (
    <button
      onClick={() => onChange(value)}
      className="flex items-center gap-2 rounded-full border-4 px-4 py-2 text-xs font-black uppercase tracking-widest transition-all duration-200 hover:scale-105 active:scale-95"
      style={
        active
          ? { borderColor: color, background: `${color}22`, color, boxShadow: `0 0 12px ${color}50` }
          : { borderStyle: "dashed", borderColor: `${color}50`, color: `${color}80` }
      }
    >
      <Icon className="size-3.5" style={{ color: active ? color : `${color}80` }} />
      {label}
    </button>
  )
}

// ── 用户管理 Tab ──────────────────────────────────────────────────────────────

function UsersTab({ token }: { token: string }) {
  const [users,   setUsers]   = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setUsers(await r.json())
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleBan = async (user: AdminUser) => {
    setActing(user.id)
    const endpoint = user.banned ? "unban" : "ban"
    try {
      await fetch(`${apiBase}/api/admin/users/${user.id}/${endpoint}`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      await load()
    } finally {
      setActing(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center gap-3 py-20">
      <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
      <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
    </div>
  )
  if (error) return (
    <div className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
      style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}>
      {error}
    </div>
  )

  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: "3px solid rgba(255,255,255,0.08)" }}>
      {/* 表头 */}
      <div
        className="hidden sm:grid grid-cols-[1fr_180px_80px_60px_60px_100px] items-center gap-2 px-5 py-3 text-xs font-black uppercase tracking-widest"
        style={{ background: "#1A0D2E", borderBottom: "3px solid rgba(255,255,255,0.08)", color: "#FF3AF2" }}
      >
        <span>用户名 / 邮箱</span>
        <span>注册时间</span>
        <span className="text-center">坦克数</span>
        <span className="text-center">管理员</span>
        <span className="text-center">状态</span>
        <span className="text-right">操作</span>
      </div>
      {users.map((u, i) => (
        <div
          key={u.id}
          className="grid grid-cols-1 sm:grid-cols-[1fr_180px_80px_60px_60px_100px] items-center gap-2 px-5 py-4 text-sm"
          style={{
            borderBottom: i < users.length - 1 ? "2px solid rgba(255,255,255,0.04)" : "none",
            background: u.banned ? "rgba(255,107,53,0.06)" : "transparent",
          }}
        >
          {/* 用户信息 */}
          <div className="flex flex-col gap-0.5">
            <span className="font-black text-white">{u.username}</span>
            <span className="text-xs text-white/30">{u.email}</span>
          </div>
          {/* 注册时间 */}
          <span className="text-xs text-white/40">
            {new Date(u.created_at).toLocaleDateString("zh-CN")}
          </span>
          {/* 坦克数 */}
          <span className="text-center font-bold text-[#00F5D4]">{u.agent_count}</span>
          {/* 管理员标记 */}
          <div className="flex justify-center">
            {u.is_admin && (
              <span className="rounded-full border-2 border-[#FFE600] px-2 py-0.5 text-[10px] font-black text-[#FFE600]">
                管理员
              </span>
            )}
          </div>
          {/* 封禁状态 */}
          <div className="flex justify-center">
            <span
              className="rounded-full border-2 px-2 py-0.5 text-[10px] font-black"
              style={
                u.banned
                  ? { borderColor: "#FF6B35", color: "#FF6B35", background: "rgba(255,107,53,0.15)" }
                  : { borderColor: "#00F5D4", color: "#00F5D4", background: "rgba(0,245,212,0.1)" }
              }
            >
              {u.banned ? "已封禁" : "正常"}
            </span>
          </div>
          {/* 操作按钮 */}
          <div className="flex justify-end">
            {!u.is_admin && (
              <button
                onClick={() => toggleBan(u)}
                disabled={acting === u.id}
                className="flex items-center gap-1 rounded-full border-2 px-3 py-1 text-[11px] font-black uppercase tracking-wide transition-all hover:scale-105 disabled:opacity-50"
                style={
                  u.banned
                    ? { borderColor: "#00F5D4", color: "#00F5D4" }
                    : { borderColor: "#FF6B35", color: "#FF6B35" }
                }
              >
                {acting === u.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : u.banned ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <Ban className="size-3" />
                )}
                {u.banned ? "解封" : "封禁"}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 坦克管理 Tab ──────────────────────────────────────────────────────────────

function TanksTab({ token }: { token: string }) {
  const [tanks,   setTanks]   = useState<AdminTank[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase}/api/admin/tanks`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setTanks(await r.json())
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const handleDelete = async (tank: AdminTank) => {
    if (!confirm(`确定要删除坦克「${tank.name}」吗？此操作不可撤销。`)) return
    setDeleting(tank.agent_id)
    try {
      await fetch(`${apiBase}/api/admin/tanks/${tank.agent_id}`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      await load()
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center gap-3 py-20">
      <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
      <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
    </div>
  )
  if (error) return (
    <div className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
      style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}>
      {error}
    </div>
  )

  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: "3px solid rgba(255,255,255,0.08)" }}>
      {/* 表头 */}
      <div
        className="hidden sm:grid grid-cols-[1fr_120px_80px_80px_140px_80px] items-center gap-2 px-5 py-3 text-xs font-black uppercase tracking-widest"
        style={{ background: "#1A0D2E", borderBottom: "3px solid rgba(255,255,255,0.08)", color: "#7B2FFF" }}
      >
        <span>坦克名</span>
        <span>所有者</span>
        <span className="text-right">Elo</span>
        <span className="text-right">PvP 场次</span>
        <span>创建时间</span>
        <span className="text-right">操作</span>
      </div>
      {tanks.map((t, i) => (
        <div
          key={t.agent_id}
          className="grid grid-cols-1 sm:grid-cols-[1fr_120px_80px_80px_140px_80px] items-center gap-2 px-5 py-4 text-sm"
          style={{ borderBottom: i < tanks.length - 1 ? "2px solid rgba(255,255,255,0.04)" : "none" }}
        >
          <div className="flex items-center gap-2">
            <span className="font-black text-white">{t.name}</span>
            <Link
              href={`/tanks/${t.agent_id}`}
              className="text-[#7B2FFF] hover:text-[#FF3AF2] transition-colors"
            >
              <ExternalLink className="size-3" />
            </Link>
          </div>
          <span className="text-xs font-bold text-white/60">{t.owner_username}</span>
          <span className="text-right font-black text-[#FFE600]">{Math.round(t.elo)}</span>
          <span className="text-right text-white/60">{t.pvp_battles}</span>
          <span className="text-xs text-white/30">
            {new Date(t.created_at).toLocaleDateString("zh-CN")}
          </span>
          <div className="flex justify-end">
            <button
              onClick={() => handleDelete(t)}
              disabled={deleting === t.agent_id}
              className="flex items-center gap-1 rounded-full border-2 border-[#FF6B35] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#FF6B35] transition-all hover:bg-[#FF6B35]/10 hover:scale-105 disabled:opacity-50"
            >
              {deleting === t.agent_id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 近期对战 Tab ──────────────────────────────────────────────────────────────

function BattlesTab({ token }: { token: string }) {
  const [battles, setBattles] = useState<RecentBattle[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/admin/battles`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(async r => {
      if (!r.ok) throw new Error()
      const data = await r.json()
      setBattles(Array.isArray(data) ? data : [])
    })
    .catch(() => setError("加载失败"))
    .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="flex items-center justify-center gap-3 py-20">
      <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
      <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
    </div>
  )
  if (error) return (
    <div className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
      style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}>
      {error}
    </div>
  )

  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: "3px solid rgba(255,255,255,0.08)" }}>
      <div
        className="hidden sm:grid grid-cols-[1fr_1fr_1fr_80px_140px_80px] items-center gap-2 px-5 py-3 text-xs font-black uppercase tracking-widest"
        style={{ background: "#1A0D2E", borderBottom: "3px solid rgba(255,255,255,0.08)", color: "#00F5D4" }}
      >
        <span>挑战方</span>
        <span>对手</span>
        <span>胜者</span>
        <span className="text-right">回合</span>
        <span>时间</span>
        <span className="text-right">回放</span>
      </div>
      {battles.slice(0, 50).map((b, i) => (
        <div
          key={b.id}
          className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_80px_140px_80px] items-center gap-2 px-5 py-3 text-sm"
          style={{ borderBottom: i < battles.length - 1 ? "2px solid rgba(255,255,255,0.04)" : "none" }}
        >
          <span className="font-bold text-white truncate">{b.challenger}</span>
          <span className="text-white/60 truncate">{b.opponent}</span>
          <span className="font-black" style={{ color: b.winner === b.challenger ? "#00F5D4" : "#FF3AF2" }}>
            {b.winner}
          </span>
          <span className="text-right text-white/40 text-xs">{b.total_ticks}r</span>
          <span className="text-xs text-white/30">
            {new Date(b.created_at).toLocaleString("zh-CN")}
          </span>
          <div className="flex justify-end">
            <Link
              href={`/replay/${b.id}`}
              className="rounded-full border-2 border-dashed border-[#7B2FFF] px-3 py-1 text-[11px] font-black text-[#7B2FFF] transition-all hover:bg-[#7B2FFF]/10"
            >
              回放
            </Link>
          </div>
        </div>
      ))}
      {battles.length === 0 && (
        <p className="py-10 text-center text-sm text-white/30">暂无对战记录</p>
      )}
    </div>
  )
}

// ── 系统指标 Tab ──────────────────────────────────────────────────────────────

function SystemStatsTab({ token }: { token: string }) {
  const [stats,   setStats]   = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(async r => {
      if (!r.ok) throw new Error()
      return r.json() as Promise<AdminStats>
    })
    .then(setStats)
    .catch(() => setError("加载失败"))
    .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="flex items-center justify-center gap-3 py-20">
      <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
      <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
    </div>
  )
  if (error || !stats) return (
    <div className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
      style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}>
      {error ?? "加载失败"}
    </div>
  )

  const metrics = [
    { label: "注册用户",     value: stats.total_users,      color: "#FF3AF2" },
    { label: "坦克总数",     value: stats.total_agents,     color: "#00F5D4" },
    { label: "全部对战",     value: stats.total_battles,    color: "#FFE600" },
    { label: "过去 24h 对战", value: stats.battles_last_24h, color: "#FF6B35" },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {metrics.map(m => (
        <div
          key={m.label}
          className="rounded-2xl p-6 text-center"
          style={{
            background: "#12081F",
            border:     `4px solid ${m.color}`,
            boxShadow:  `4px 4px 0 ${m.color}50`,
          }}
        >
          <p
            className="text-4xl font-black tabular-nums"
            style={{ color: m.color, textShadow: `0 0 16px ${m.color}60` }}
          >
            {m.value.toLocaleString()}
          </p>
          <p className="mt-2 text-xs font-black uppercase tracking-widest text-white/40">{m.label}</p>
        </div>
      ))}
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab,     setTab]     = useState<TabKey>("users")
  const [token,   setToken]   = useState<string | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null) // null=检查中

  useEffect(() => {
    const t = getCookie("token") ?? ""
    setToken(t)
    if (!t) { setAllowed(false); return }

    // 调用管理员接口检查权限
    fetch(`${apiBase}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    .then(r => setAllowed(r.ok))
    .catch(() => setAllowed(false))
  }, [])

  // 权限检查中
  if (allowed === null) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[#0D0D1A]">
        <Loader2 className="size-8 animate-spin text-[#FF3AF2]" />
      </main>
    )
  }

  // 无权限
  if (!allowed) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-[#0D0D1A] px-4 py-20">
        <div
          className="rounded-3xl px-8 py-10 text-center"
          style={{
            border:    "4px solid #FF6B35",
            boxShadow: "8px 8px 0 #FFE600",
            background: "#12081F",
          }}
        >
          <div className="mb-4 flex justify-center">
            <div
              className="flex size-16 items-center justify-center rounded-full"
              style={{ background: "rgba(255,107,53,0.15)", border: "4px solid #FF6B35" }}
            >
              <Shield className="size-8 text-[#FF6B35]" />
            </div>
          </div>
          <h1 className="text-2xl font-black text-white">无权限访问</h1>
          <p className="mt-2 text-sm text-white/40">此页面仅限管理员访问</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full border-4 border-[#7B2FFF] px-6 py-2 text-sm font-black uppercase tracking-wide text-[#7B2FFF] transition-all hover:bg-[#7B2FFF]/10"
          >
            返回首页
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">
      {/* 背景纹理 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />

      <div className="relative mx-auto w-full max-w-6xl flex flex-col gap-8">

        {/* 页面标题 */}
        <div className="flex items-center gap-4">
          <div
            className="flex size-12 items-center justify-center rounded-2xl"
            style={{ background: "rgba(255,107,53,0.15)", border: "4px solid #FF6B35" }}
          >
            <Shield className="size-6 text-[#FF6B35]" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1
                className="text-4xl font-black uppercase tracking-tighter text-white"
                style={{
                  fontFamily: "var(--font-outfit)",
                  textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
                }}
              >
                管理后台
              </h1>
              <span
                className="rounded-full border-2 border-[#FF6B35] px-3 py-1 text-xs font-black uppercase tracking-widest text-[#FF6B35]"
                style={{ background: "rgba(255,107,53,0.15)" }}
              >
                ADMIN
              </span>
            </div>
            <p className="text-sm text-white/30">DeepTank 平台管理员控制台</p>
          </div>
        </div>

        {/* Tab 导航 */}
        <div className="flex flex-wrap gap-3">
          <TabButton value="users"   current={tab} onChange={setTab} icon={Users}    label="用户管理" color="#FF3AF2" />
          <TabButton value="tanks"   current={tab} onChange={setTab} icon={Shield}   label="坦克管理" color="#7B2FFF" />
          <TabButton value="battles" current={tab} onChange={setTab} icon={Swords}   label="近期对战" color="#00F5D4" />
          <TabButton value="stats"   current={tab} onChange={setTab} icon={BarChart3} label="系统指标" color="#FFE600" />
        </div>

        {/* Tab 内容区 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {tab === "users"   && <UsersTab   token={token!} />}
            {tab === "tanks"   && <TanksTab   token={token!} />}
            {tab === "battles" && <BattlesTab token={token!} />}
            {tab === "stats"   && <SystemStatsTab token={token!} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}
