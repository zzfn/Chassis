"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Copy, Check, Terminal, Cpu, Shield, Calendar, Mail } from "lucide-react"
import { getCookie } from "@/lib/cookie"

interface UserProfile {
  id: string
  username: string
  email: string
  tank_count: number
  created_at: string
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// 根据用户名生成唯一色相
function nameHue(name: string) {
  return [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
}

// 用户名缩写
function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

// ── 扫描线叠加层 ─────────────────────────────────────────────────────────────
function Scanlines() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 rounded-none"
      style={{
        background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)",
        mixBlendMode: "multiply",
      }}
    />
  )
}

// ── Terminal 窗口顶栏 ──────────────────────────────────────────────────────────
function TerminalBar({ title }: { title: string }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 border-b-2"
      style={{ background: "rgba(0,245,212,0.07)", borderColor: "#00F5D4" }}
    >
      <span className="flex gap-1.5">
        <span className="block size-3 rounded-full" style={{ background: "#FF3AF2", boxShadow: "0 0 6px #FF3AF2" }} />
        <span className="block size-3 rounded-full" style={{ background: "#FFE600", boxShadow: "0 0 6px #FFE600" }} />
        <span className="block size-3 rounded-full" style={{ background: "#00F5D4", boxShadow: "0 0 6px #00F5D4" }} />
      </span>
      <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "#00F5D4" }}>
        {title}
      </span>
      <span className="ml-auto font-mono text-[10px] tracking-widest opacity-50" style={{ color: "#00F5D4" }}>
        [ACTIVE]
      </span>
    </div>
  )
}

// ── 信息行 ────────────────────────────────────────────────────────────────────
function InfoRow({
  icon: Icon,
  label,
  value,
  accent,
  isLast,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: string
  isLast?: boolean
}) {
  return (
    <div
      className="group flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-white/[0.02]"
      style={{ borderBottom: isLast ? "none" : "1px dashed rgba(255,58,242,0.2)" }}
    >
      {/* > 前缀 */}
      <span
        className="shrink-0 font-mono text-sm font-black select-none"
        style={{ color: accent }}
      >
        &gt;_
      </span>

      {/* 图标 */}
      <Icon className="shrink-0 size-4 opacity-60" style={{ color: accent }} />

      {/* 标签 */}
      <span
        className="w-28 shrink-0 font-mono text-[11px] font-black uppercase tracking-[0.25em]"
        style={{ color: accent, opacity: 0.7 }}
      >
        {label}
      </span>

      {/* 虚线分隔 */}
      <span
        className="flex-1 font-mono text-[11px] opacity-20 overflow-hidden select-none"
        style={{ color: accent, letterSpacing: "0.15em" }}
        aria-hidden
      >
        {"·".repeat(60)}
      </span>

      {/* 值 */}
      <span className="font-mono text-sm text-white/90 group-hover:text-white transition-colors">
        {value}
      </span>
    </div>
  )
}

// ── 斜切 CopyID 按钮 ──────────────────────────────────────────────────────────
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.button
      onClick={handleCopy}
      whileTap={{ scale: 0.95 }}
      className="relative overflow-hidden -skew-x-6 px-4 py-1.5 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 hover:skew-x-0"
      style={{
        border: `2px solid ${copied ? "#00F5D4" : "#FF3AF2"}`,
        color: copied ? "#00F5D4" : "#FF3AF2",
        background: copied ? "rgba(0,245,212,0.1)" : "transparent",
        boxShadow: copied ? "0 0 12px rgba(0,245,212,0.4)" : "none",
      }}
    >
      {/* 内层反向矫正 */}
      <span className="inline-flex items-center gap-1.5 skew-x-6">
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.span
              key="check"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="flex items-center gap-1.5"
            >
              <Check className="size-3" />
              已复制
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="flex items-center gap-1.5"
            >
              <Copy className="size-3" />
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  function getToken() {
    const t = getCookie("token")
    if (!t) { router.push("/login"); return null }
    return t
  }

  useEffect(() => {
    const token = getToken()
    if (!token) return
    fetch(`${apiBase}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(p => setProfile(p))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[#0D0D1A]">
        <div className="flex flex-col items-center gap-3">
          <Loader2
            className="size-8 animate-spin"
            style={{ color: "#FF3AF2", filter: "drop-shadow(0 0 8px #FF3AF2)" }}
          />
          <p
            className="font-mono text-xs uppercase tracking-[0.4em]"
            style={{ color: "#FF3AF2", opacity: 0.6 }}
          >
            LOADING_USER_DATA...
          </p>
        </div>
      </main>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[#0D0D1A] px-4">
        <div
          className="flex flex-col items-center gap-5 p-8"
          style={{ border: "2px dashed #FF3AF2", background: "rgba(255,58,242,0.05)" }}
        >
          <p className="font-mono text-sm uppercase tracking-widest" style={{ color: "#FF3AF2" }}>
            [ERR] 无法连接到 API 服务器
          </p>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => { setFetchError(false); setLoading(true); window.location.reload() }}
            className="-skew-x-6 border-2 px-5 py-2 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 hover:skew-x-0"
            style={{
              borderColor: "#00F5D4",
              color: "#00F5D4",
            }}
          >
            <span className="inline-block skew-x-6">重新连接</span>
          </motion.button>
        </div>
      </main>
    )
  }

  const hue        = nameHue(profile?.username ?? "unknown")
  const avatarColor = `hsl(${hue}, 80%, 60%)`
  const shortId    = profile?.id ? `usr_${profile.id.replace(/-/g, "").slice(0, 16)}` : "—"
  const joinDate   = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
    : "—"

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">

      {/* ── 背景层 ── */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.06]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      {/* perspective 网格地板 */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-80 opacity-20"
        style={{
          backgroundImage: [
            "linear-gradient(transparent 95%, #FF3AF2 95%)",
            "linear-gradient(90deg, transparent 95%, #FF3AF2 95%)",
          ].join(", "),
          backgroundSize: "40px 40px",
          transform: "perspective(400px) rotateX(60deg) translateY(80px) scale(2.5)",
          transformOrigin: "bottom center",
          maskImage: "linear-gradient(to top, black 10%, transparent 80%)",
          WebkitMaskImage: "linear-gradient(to top, black 10%, transparent 80%)",
        }}
      />

      {/* 浮动太阳光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-80px] top-[-60px] size-[480px] rounded-full opacity-10"
        style={{
          background: "radial-gradient(circle, #FFE600 0%, #FF3AF2 50%, transparent 75%)",
          filter: "blur(80px)",
        }}
      />

      {/* 浮动装饰 */}
      <div className="animate-max-float pointer-events-none absolute top-[8%] right-[5%] select-none text-4xl" aria-hidden>⚙️</div>
      <div className="animate-max-bounce pointer-events-none absolute top-[20%] left-[3%] select-none text-3xl" aria-hidden>📡</div>
      <div
        className="animate-max-spin-slow pointer-events-none absolute bottom-[12%] left-[6%] size-16 rounded-full"
        style={{ border: "3px solid #00F5D4", opacity: 0.15 }}
        aria-hidden
      />
      <div
        className="animate-max-float-reverse pointer-events-none absolute bottom-[20%] right-[8%] size-10 rotate-45"
        style={{ border: "3px solid #FFE600", opacity: 0.2 }}
        aria-hidden
      />

      {/* ── 内容区 ── */}
      <div className="relative z-10 mx-auto w-full max-w-xl flex flex-col gap-8">

        {/* ── 页面标题 ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <p
            className="mb-2 font-mono text-[11px] font-black uppercase tracking-[0.5em]"
            style={{ color: "#FF3AF2" }}
          >
            &gt; SYS_CONFIG.EXE
          </p>
          <h1
            className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "3px 3px 0px #7B2FFF, 6px 6px 0px #FF3AF2",
            }}
          >
            账户中心
          </h1>
        </motion.div>

        {/* ── PILOT_IDENTITY 卡 ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          className="relative overflow-hidden"
          style={{
            border: "2px solid #00F5D4",
            background: "rgba(0,0,0,0.75)",
            boxShadow: "0 0 30px rgba(0,245,212,0.15), 6px 6px 0 rgba(255,58,242,0.3)",
          }}
        >
          <Scanlines />
          <TerminalBar title="PILOT_IDENTITY.DAT" />

          <div className="relative flex items-center gap-5 p-6">
            {/* 头像 — 旋转扫描光圈 */}
            <div className="relative shrink-0">
              {/* 外圈旋转光圈 */}
              <div
                className="animate-max-spin-slow absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(${avatarColor}, #FF3AF2, #00F5D4, ${avatarColor})`,
                  padding: "3px",
                }}
              />
              {/* 头像主体 */}
              <div
                className="relative flex size-20 items-center justify-center rounded-full font-black text-2xl text-white select-none z-10"
                style={{
                  background: `linear-gradient(135deg, hsl(${hue},50%,12%), hsl(${hue},60%,22%))`,
                  border: `3px solid ${avatarColor}`,
                  boxShadow: `0 0 20px ${avatarColor}60, inset 0 0 12px ${avatarColor}20`,
                  fontFamily: "var(--font-outfit)",
                }}
              >
                {initials(profile?.username ?? "??")}
              </div>
            </div>

            {/* 用户名 + ID */}
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center gap-2">
                {/* ONLINE badge */}
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[9px] font-black uppercase tracking-widest"
                  style={{ border: "1px solid #00F5D4", color: "#00F5D4", background: "rgba(0,245,212,0.08)" }}
                >
                  <span className="size-1.5 rounded-full bg-[#00F5D4] animate-pulse inline-block" />
                  ONLINE
                </span>
              </div>

              <span
                className="font-black text-3xl leading-none text-white truncate"
                style={{
                  fontFamily: "var(--font-outfit)",
                  textShadow: `0 0 14px ${avatarColor}80`,
                }}
              >
                {profile?.username}
              </span>

              {/* ID 行 */}
              <div className="flex items-center gap-3 flex-wrap">
                <code
                  className="font-mono text-xs truncate max-w-[180px]"
                  style={{ color: "#FF3AF2", opacity: 0.7 }}
                >
                  {shortId}
                </code>
                <CopyButton text={profile?.id ?? ""} label="复制 ID" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── ACCOUNT_DATA 卡 ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
          style={{
            border: "2px solid rgba(255,58,242,0.35)",
            borderTop: "2px solid #FF3AF2",
            background: "rgba(26,16,60,0.85)",
            boxShadow: "0 0 20px rgba(255,58,242,0.1)",
          }}
        >
          <TerminalBar title="ACCOUNT_DATA.SYS" />

          <div className="flex flex-col">
            <InfoRow
              icon={Mail}
              label="EMAIL"
              value={profile?.email ?? "—"}
              accent="#FF3AF2"
            />
            <InfoRow
              icon={Cpu}
              label="TANKS"
              value={`${profile?.tank_count ?? 0} UNIT${(profile?.tank_count ?? 0) !== 1 ? "S" : ""}`}
              accent="#00F5D4"
            />
            <InfoRow
              icon={Calendar}
              label="JOINED"
              value={joinDate}
              accent="#FFE600"
              isLast
            />
          </div>

          {/* 底部状态栏 */}
          <div
            className="flex items-center justify-between px-5 py-2"
            style={{
              borderTop: "2px solid rgba(255,58,242,0.2)",
              background: "#090014",
            }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-40" style={{ color: "#FF3AF2" }}>
              3 FIELDS LOADED
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-40" style={{ color: "#00F5D4" }}>
              STATUS: OK
            </span>
          </div>
        </motion.div>

        {/* ── SYSTEM_INFO 小卡（坦克数醒目展示） ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
          className="grid grid-cols-3 gap-3"
        >
          {[
            { label: "TANKS", value: profile?.tank_count ?? 0, accent: "#FFE600" },
            { label: "STATUS", value: "ACTIVE", accent: "#00F5D4" },
            { label: "TIER",   value: "PILOT",  accent: "#FF3AF2" },
          ].map(({ label, value, accent }) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center gap-1 py-4 transition-colors duration-200 hover:bg-white/[0.02]"
              style={{
                border: `2px solid ${accent}40`,
                borderTop: `2px solid ${accent}`,
                background: "rgba(0,0,0,0.5)",
              }}
            >
              <span
                className="font-black text-2xl leading-none"
                style={{
                  fontFamily: "var(--font-outfit)",
                  color: accent,
                  textShadow: `0 0 10px ${accent}80`,
                }}
              >
                {value}
              </span>
              <span
                className="font-mono text-[9px] uppercase tracking-[0.3em] opacity-60"
                style={{ color: accent }}
              >
                {label}
              </span>
            </div>
          ))}
        </motion.div>

      </div>
    </main>
  )
}
