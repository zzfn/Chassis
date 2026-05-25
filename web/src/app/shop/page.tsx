"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Star, ShoppingCart, Check, Lock } from "lucide-react"
import { getCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface BulletSkin {
  id: string
  name: string
  price: number
  color: string
  shape: "circle" | "diamond" | "star"
  glow: boolean
}

interface NameColor {
  id: string
  name: string
  price: number
  color: string
  gradient?: boolean
}

// ── 商品数据 ──────────────────────────────────────────────────────────────────

const BULLET_SKINS: BulletSkin[] = [
  { id: "default", name: "默认",   price: 0,   color: "#fef08a", shape: "circle",  glow: false },
  { id: "fire",    name: "火焰",   price: 80,  color: "#ff5500", shape: "circle",  glow: true  },
  { id: "plasma",  name: "等离子", price: 80,  color: "#22d3ee", shape: "circle",  glow: true  },
  { id: "void",    name: "虚空",   price: 120, color: "#a855f7", shape: "diamond", glow: true  },
  { id: "gold",    name: "黄金",   price: 200, color: "#fbbf24", shape: "star",    glow: false },
]

const NAME_COLORS: NameColor[] = [
  { id: "white",   name: "默认白色", price: 0,   color: "#ffffff"               },
  { id: "magenta", name: "品红",     price: 60,  color: "#FF3AF2"               },
  { id: "cyan",    name: "青色",     price: 60,  color: "#00F5D4"               },
  { id: "yellow",  name: "黄色",     price: 60,  color: "#FFE600"               },
  { id: "orange",  name: "橙色",     price: 100, color: "#FF6B35"               },
  { id: "purple",  name: "紫色渐变", price: 150, color: "#7B2FFF", gradient: true },
]

const COMING_SOON = [
  { id: "trail",     name: "坦克轨迹特效", desc: "在战场上留下炫彩光轨" },
  { id: "explosion", name: "爆炸动画皮肤", desc: "独特的击毁爆炸粒子效果" },
  { id: "title",     name: "专属称号",     desc: "在名字旁显示荣耀头衔" },
]

const SECTION_ACCENTS = {
  bullets:    "#FF6B35",
  names:      "#00F5D4",
  comingSoon: "#7B2FFF",
}

// ── 子弹 SVG 动画预览 ─────────────────────────────────────────────────────────

function BulletPreview({ skin }: { skin: BulletSkin }) {
  const dur = "1.4s"

  // 圆形子弹（默认、火焰、等离子）
  if (skin.shape === "circle") {
    return (
      <svg
        width="180" height="48"
        viewBox="0 0 180 48"
        className="rounded-xl"
        style={{ background: "rgba(0,0,0,0.5)" }}
        aria-label={`${skin.name}子弹预览`}
      >
        {/* 轨道线 */}
        <line x1="8" y1="24" x2="172" y2="24" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 4" />

        {/* 尾焰（仅发光型） */}
        {skin.glow && (
          <ellipse cx="0" cy="24" rx="10" ry="4" fill={skin.color} opacity="0.45">
            <animateMotion dur={dur} repeatCount="indefinite" path="M 8 0 H 172" />
            <animate attributeName="opacity" values="0;0.45;0" dur={dur} repeatCount="indefinite" />
          </ellipse>
        )}

        {/* 子弹主体 */}
        <circle
          cx="0" cy="0" r="6"
          fill={skin.color}
          style={{ filter: skin.glow ? `drop-shadow(0 0 6px ${skin.color})` : "none" }}
        >
          <animateMotion dur={dur} repeatCount="indefinite" path="M 8 24 H 172" />
        </circle>
      </svg>
    )
  }

  // 菱形子弹（虚空）
  if (skin.shape === "diamond") {
    return (
      <svg
        width="180" height="48"
        viewBox="0 0 180 48"
        className="rounded-xl"
        style={{ background: "rgba(0,0,0,0.5)" }}
        aria-label={`${skin.name}子弹预览`}
      >
        <line x1="8" y1="24" x2="172" y2="24" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 4" />

        {skin.glow && (
          <ellipse cx="0" cy="24" rx="12" ry="5" fill={skin.color} opacity="0.35">
            <animateMotion dur={dur} repeatCount="indefinite" path="M 8 0 H 172" />
            <animate attributeName="opacity" values="0;0.35;0" dur={dur} repeatCount="indefinite" />
          </ellipse>
        )}

        <polygon
          points="0,-7 7,0 0,7 -7,0"
          fill={skin.color}
          style={{ filter: `drop-shadow(0 0 8px ${skin.color})` }}
        >
          <animateMotion dur={dur} repeatCount="indefinite" path="M 8 24 H 172" />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0" to="360"
            dur="0.7s"
            repeatCount="indefinite"
            additive="sum"
          />
        </polygon>
      </svg>
    )
  }

  // 五角星子弹（黄金）
  const starPath = "M0,-9 L2.1,-3 L8.6,-3 L3.5,1.5 L5.5,8.5 L0,4.5 L-5.5,8.5 L-3.5,1.5 L-8.6,-3 L-2.1,-3 Z"
  return (
    <svg
      width="180" height="48"
      viewBox="0 0 180 48"
      className="rounded-xl"
      style={{ background: "rgba(0,0,0,0.5)" }}
      aria-label={`${skin.name}子弹预览`}
    >
      <line x1="8" y1="24" x2="172" y2="24" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 4" />

      {/* 金色光粒子 */}
      {([0.2, 0.5, 0.8] as const).map((offset, i) => (
        <circle key={i} r="2" fill={skin.color} opacity="0">
          <animateMotion dur={dur} repeatCount="indefinite" path="M 8 24 H 172" begin={`${-offset * 1.4}s`} />
          <animate attributeName="cy" values="-4;4;-4" dur="0.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.8;0" dur={dur} repeatCount="indefinite" begin={`${-offset * 1.4}s`} />
        </circle>
      ))}

      <path
        d={starPath}
        fill={skin.color}
        style={{ filter: `drop-shadow(0 0 5px ${skin.color}) drop-shadow(0 0 10px ${skin.color})` }}
      >
        <animateMotion dur={dur} repeatCount="indefinite" path="M 8 24 H 172" />
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0" to="360"
          dur="1s"
          repeatCount="indefinite"
          additive="sum"
        />
      </path>
    </svg>
  )
}

// ── 子弹商品卡 ────────────────────────────────────────────────────────────────

function BulletCard({
  skin, balance, owned, equipped, onBuy, onEquip,
}: {
  skin: BulletSkin
  balance: number
  owned: boolean
  equipped: boolean
  onBuy: () => void
  onEquip: () => void
}) {
  const canAfford = balance >= skin.price
  const isFree    = skin.price === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ duration: 0.2 }}
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: "rgba(255,107,53,0.07)",
        border:     `3px solid ${equipped ? "#FF6B35" : "rgba(255,107,53,0.3)"}`,
        boxShadow:  equipped ? "0 0 20px rgba(255,107,53,0.3), 4px 4px 0 #FF3AF2" : "none",
      }}
    >
      {equipped && (
        <div
          className="absolute top-2 right-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
          style={{ background: "#FF6B35", color: "#0D0D1A" }}
        >
          <Check className="size-3" />
          装备中
        </div>
      )}

      <div className="flex justify-center">
        <BulletPreview skin={skin} />
      </div>

      <div className="text-center">
        <p className="text-sm font-black uppercase tracking-wider text-white">{skin.name}</p>
        <p className="text-xs font-bold mt-0.5" style={{ color: "#FF6B35" }}>
          {isFree ? "免费" : `${skin.price} ⭐`}
        </p>
      </div>

      {isFree || owned ? (
        <button
          onClick={onEquip}
          disabled={equipped}
          className="w-full rounded-full border-2 py-2 text-xs font-black uppercase tracking-widest transition-all duration-150 disabled:opacity-50 disabled:cursor-default"
          style={{
            borderColor: equipped ? "#FF6B35" : "rgba(255,107,53,0.5)",
            color:       equipped ? "#FF6B35" : "rgba(255,255,255,0.7)",
            background:  equipped ? "rgba(255,107,53,0.15)" : "transparent",
          }}
        >
          {equipped ? "已装备" : "装备"}
        </button>
      ) : (
        <button
          onClick={canAfford ? onBuy : undefined}
          disabled={!canAfford}
          className="w-full rounded-full border-2 py-2 text-xs font-black uppercase tracking-widest transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{
            borderColor: canAfford ? "#FF6B35" : "rgba(255,255,255,0.2)",
            color:       canAfford ? "#0D0D1A"  : "rgba(255,255,255,0.35)",
            background:  canAfford ? "linear-gradient(135deg, #FF6B35, #FF3AF2)" : "rgba(255,255,255,0.05)",
          }}
        >
          {canAfford ? "购买" : "星币不足"}
        </button>
      )}
    </motion.div>
  )
}

// ── 名称颜色商品卡 ────────────────────────────────────────────────────────────

function NameColorCard({
  item, balance, owned, equipped, previewName, onBuy, onEquip,
}: {
  item: NameColor
  balance: number
  owned: boolean
  equipped: boolean
  previewName: string
  onBuy: () => void
  onEquip: () => void
}) {
  const canAfford = balance >= item.price
  const isFree    = item.price === 0

  const nameStyle: React.CSSProperties = item.gradient
    ? {
        background:           "linear-gradient(90deg, #7B2FFF, #FF3AF2, #00F5D4)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor:  "transparent",
        backgroundClip:       "text",
      }
    : { color: item.color }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ duration: 0.2 }}
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: "rgba(0,245,212,0.07)",
        border:     `3px solid ${equipped ? "#00F5D4" : "rgba(0,245,212,0.25)"}`,
        boxShadow:  equipped ? "0 0 20px rgba(0,245,212,0.25), 4px 4px 0 #7B2FFF" : "none",
      }}
    >
      {equipped && (
        <div
          className="absolute top-2 right-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
          style={{ background: "#00F5D4", color: "#0D0D1A" }}
        >
          <Check className="size-3" />
          装备中
        </div>
      )}

      {/* 名称颜色实时预览 */}
      <div
        className="h-16 flex items-center justify-center rounded-xl"
        style={{ background: "rgba(0,0,0,0.4)" }}
      >
        <span className="text-lg font-black tracking-wide" style={nameStyle}>
          {previewName || "TANK_NAME"}
        </span>
      </div>

      <div className="text-center">
        <p className="text-sm font-black uppercase tracking-wider text-white">{item.name}</p>
        <p className="text-xs font-bold mt-0.5" style={{ color: "#00F5D4" }}>
          {isFree ? "免费" : `${item.price} ⭐`}
        </p>
      </div>

      {isFree || owned ? (
        <button
          onClick={onEquip}
          disabled={equipped}
          className="w-full rounded-full border-2 py-2 text-xs font-black uppercase tracking-widest transition-all duration-150 disabled:opacity-50 disabled:cursor-default"
          style={{
            borderColor: equipped ? "#00F5D4" : "rgba(0,245,212,0.4)",
            color:       equipped ? "#00F5D4" : "rgba(255,255,255,0.7)",
            background:  equipped ? "rgba(0,245,212,0.1)" : "transparent",
          }}
        >
          {equipped ? "已装备" : "装备"}
        </button>
      ) : (
        <button
          onClick={canAfford ? onBuy : undefined}
          disabled={!canAfford}
          className="w-full rounded-full border-2 py-2 text-xs font-black uppercase tracking-widest transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{
            borderColor: canAfford ? "#00F5D4" : "rgba(255,255,255,0.2)",
            color:       canAfford ? "#0D0D1A" : "rgba(255,255,255,0.35)",
            background:  canAfford ? "linear-gradient(135deg, #00F5D4, #7B2FFF)" : "rgba(255,255,255,0.05)",
          }}
        >
          {canAfford ? "购买" : "星币不足"}
        </button>
      )}
    </motion.div>
  )
}

// ── 即将推出占位卡 ────────────────────────────────────────────────────────────

function ComingSoonCard({ item, index }: { item: typeof COMING_SOON[number]; index: number }) {
  const accent = ["#FF3AF2", "#FFE600", "#00F5D4"][index % 3]!
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.07 }}
      className="relative overflow-hidden rounded-2xl"
      style={{
        border:     `3px solid ${accent}40`,
        background: `${accent}08`,
      }}
    >
      {/* 模糊遮罩 */}
      <div
        className="absolute inset-0 z-10 backdrop-blur-[2px]"
        style={{ background: "rgba(13,13,26,0.55)" }}
      />

      {/* COMING SOON 标签 */}
      <div
        className="absolute top-3 right-3 z-20 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
        style={{ background: accent, color: "#0D0D1A" }}
      >
        COMING SOON
      </div>

      {/* 内容（被遮罩覆盖） */}
      <div className="p-5 flex flex-col gap-3">
        <div
          className="h-20 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
        >
          <Lock className="size-8 opacity-20" style={{ color: accent }} />
        </div>
        <div>
          <p className="text-sm font-black uppercase tracking-wider text-white">{item.name}</p>
          <p className="text-xs text-white/40 mt-0.5">{item.desc}</p>
        </div>
        <div
          className="w-full rounded-full border-2 py-2 text-center text-xs font-black uppercase tracking-widest opacity-30"
          style={{ borderColor: accent, color: accent }}
        >
          敬请期待
        </div>
      </div>
    </motion.div>
  )
}

// ── Section 标题 ──────────────────────────────────────────────────────────────

function SectionHeader({
  title, subtitle, accent, index,
}: {
  title: string
  subtitle: string
  accent: string
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.12 }}
      className="mb-6"
    >
      <div className="flex items-center gap-3 mb-1">
        <div className="h-1.5 w-10 rounded-full" style={{ background: accent }} />
        <h2
          className="text-2xl font-black uppercase tracking-tight text-white"
          style={{ textShadow: `2px 2px 0 ${accent}` }}
        >
          {title}
        </h2>
      </div>
      <p className="text-sm font-bold pl-[52px]" style={{ color: `${accent}99` }}>
        {subtitle}
      </p>
    </motion.div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function ShopPage() {
  const [balance, setBalance]                     = useState(0)
  const [ownedBullets, setOwnedBullets]           = useState<Set<string>>(new Set(["default"]))
  const [ownedNameColors, setOwnedNameColors]     = useState<Set<string>>(new Set(["white"]))
  const [equippedBullet, setEquippedBullet]       = useState("default")
  const [equippedNameColor, setEquippedNameColor] = useState("white")
  const [isLoggedIn, setIsLoggedIn]               = useState<boolean | null>(null)
  const [previewName, setPreviewName]             = useState("TANK_NAME")

  useEffect(() => {
    const token = getCookie("token")
    if (!token) {
      Promise.resolve().then(() => setIsLoggedIn(false))
      return
    }

    const headers = { Authorization: `Bearer ${token}` }

    Promise.all([
      fetch(`${apiBase}/api/me`,             { headers }).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/shop/inventory`, { headers }).then(r => r.ok ? r.json() : null),
    ]).then(([me, inv]) => {
      setIsLoggedIn(true)
      if (me && typeof me.credits === "number") setBalance(me.credits)
      if (me?.username) setPreviewName((me.username as string).toUpperCase())
      if (inv?.items) {
        const items = inv.items as { item_type: string; item_id: string; equipped: boolean }[]
        const bullets     = new Set<string>(["default"])
        const nameColors  = new Set<string>(["white"])
        let eqBullet      = "default"
        let eqNameColor   = "white"
        for (const item of items) {
          if (item.item_type === "bullet") {
            bullets.add(item.item_id)
            if (item.equipped) eqBullet = item.item_id
          } else if (item.item_type === "name_color") {
            nameColors.add(item.item_id)
            if (item.equipped) eqNameColor = item.item_id
          }
        }
        setOwnedBullets(bullets)
        setOwnedNameColors(nameColors)
        setEquippedBullet(eqBullet)
        setEquippedNameColor(eqNameColor)
      }
    }).catch(() => setIsLoggedIn(true))
  }, [])

  async function buyBullet(skin: BulletSkin) {
    if (balance < skin.price) return
    const token = getCookie("token")
    if (!token) return
    const res = await fetch(`${apiBase}/api/shop/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item_type: "bullet", item_id: skin.id }),
    })
    if (!res.ok) return
    const data = await res.json()
    if (typeof data.credits === "number") setBalance(data.credits)
    setOwnedBullets(s => new Set([...s, skin.id]))
    await equipBullet(skin.id)
  }

  async function buyNameColor(item: NameColor) {
    if (balance < item.price) return
    const token = getCookie("token")
    if (!token) return
    const res = await fetch(`${apiBase}/api/shop/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item_type: "name_color", item_id: item.id }),
    })
    if (!res.ok) return
    const data = await res.json()
    if (typeof data.credits === "number") setBalance(data.credits)
    setOwnedNameColors(s => new Set([...s, item.id]))
    await equipNameColor(item.id)
  }

  async function equipBullet(id: string) {
    setEquippedBullet(id)
    const token = getCookie("token")
    if (!token) return
    await fetch(`${apiBase}/api/shop/equip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item_type: "bullet", item_id: id }),
    })
  }

  async function equipNameColor(id: string) {
    setEquippedNameColor(id)
    const token = getCookie("token")
    if (!token) return
    await fetch(`${apiBase}/api/shop/equip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item_type: "name_color", item_id: id }),
    })
  }

  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ background: "#0D0D1A" }}
    >
      {/* ── 透视网格 ── */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(123,47,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.3) 1px, transparent 1px)",
          backgroundSize:  "40px 40px",
          transform:       "perspective(600px) rotateX(30deg) scale(2.5)",
          transformOrigin: "50% 120%",
        }}
      />

      {/* ── Pattern dots ── */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)",
          backgroundSize:  "24px 24px",
        }}
      />

      {/* ── 渐变光晕 ── */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-40 size-[500px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #FF3AF2, transparent 70%)" }}
        />
        <div
          className="absolute top-1/3 -right-40 size-[400px] rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #00F5D4, transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 left-1/3 size-[450px] rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #7B2FFF, transparent 70%)" }}
        />
      </div>

      {/* ── 内容区 ── */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">

        {/* ── 页面标题 + 余额 ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end"
        >
          <div>
            <div className="mb-2 flex items-center gap-3">
              <ShoppingCart
                className="size-8"
                style={{ color: "#FF3AF2", filter: "drop-shadow(0 0 10px #FF3AF2)" }}
              />
              <h1
                className="text-5xl font-black uppercase tracking-tighter text-white sm:text-6xl"
                style={{ textShadow: "4px 4px 0 #FF3AF2, 8px 8px 0 #7B2FFF" }}
              >
                SHOP
              </h1>
            </div>
            <p className="text-base font-bold text-white/50 tracking-widest uppercase">
              用星币解锁专属外观
            </p>
          </div>

          {/* 星币余额卡片 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex items-center gap-3 rounded-2xl px-6 py-4"
            style={{
              background: "rgba(255,230,0,0.08)",
              border:     "3px solid #FFE600",
              boxShadow:  "0 0 24px rgba(255,230,0,0.2), 4px 4px 0 rgba(255,230,0,0.3)",
            }}
          >
            <Star
              className="size-6 fill-current shrink-0"
              style={{ color: "#FFE600", filter: "drop-shadow(0 0 8px #FFE600)" }}
            />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#FFE600]/70">星币余额</p>
              <p
                className="text-3xl font-black tabular-nums leading-none"
                style={{ color: "#FFE600", textShadow: "2px 2px 0 rgba(255,230,0,0.3)" }}
              >
                {balance.toLocaleString()}
              </p>
            </div>
            {isLoggedIn === false && (
              <span className="ml-2 text-[10px] font-bold text-white/30 uppercase tracking-widest shrink-0">
                (未登录)
              </span>
            )}
          </motion.div>
        </motion.div>

        {/* ══════════════════════════════════════
            SECTION 1 — BULLET SKINS
        ══════════════════════════════════════ */}
        <section className="mb-16">
          <SectionHeader
            title="BULLET SKINS"
            subtitle="改变你子弹的外观与特效"
            accent={SECTION_ACCENTS.bullets}
            index={0}
          />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {BULLET_SKINS.map((skin, i) => (
              <motion.div
                key={skin.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 + i * 0.06 }}
              >
                <BulletCard
                  skin={skin}
                  balance={balance}
                  owned={ownedBullets.has(skin.id)}
                  equipped={equippedBullet === skin.id}
                  onBuy={() => buyBullet(skin)}
                  onEquip={() => equipBullet(skin.id)}
                />
              </motion.div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════
            SECTION 2 — NAME COLORS
        ══════════════════════════════════════ */}
        <section className="mb-16">
          <SectionHeader
            title="NAME COLORS"
            subtitle="在战场上让你的名字更耀眼"
            accent={SECTION_ACCENTS.names}
            index={1}
          />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {NAME_COLORS.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + i * 0.06 }}
              >
                <NameColorCard
                  item={item}
                  balance={balance}
                  owned={ownedNameColors.has(item.id)}
                  equipped={equippedNameColor === item.id}
                  previewName={previewName}
                  onBuy={() => buyNameColor(item)}
                  onEquip={() => equipNameColor(item.id)}
                />
              </motion.div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════
            SECTION 3 — COMING SOON
        ══════════════════════════════════════ */}
        <section>
          <SectionHeader
            title="COMING SOON"
            subtitle="更多内容正在开发中，敬请期待"
            accent={SECTION_ACCENTS.comingSoon}
            index={2}
          />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {COMING_SOON.map((item, i) => (
              <ComingSoonCard key={item.id} item={item} index={i} />
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
