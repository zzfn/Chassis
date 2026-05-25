"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Plus, Shield, Swords, MoreHorizontal, Pencil, Trash2, Shuffle, X } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import { getEloTier } from "@/lib/elo"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

const CARD_ACCENTS  = ["#FF3AF2", "#00F5D4", "#FFE600", "#FF6B35", "#7B2FFF"]
const CARD_SHADOWS: [string, string][] = [
  ["#FFE600", "#7B2FFF"],
  ["#FF3AF2", "#FFE600"],
  ["#00F5D4", "#FF3AF2"],
  ["#7B2FFF", "#00F5D4"],
  ["#FF3AF2", "#FF6B35"],
]

const DEFAULT_CODE = `// 入门模板：技能 → 捡星 → 朝敌开火 → 冲锋
function onIdle(me, enemy, game) {
  var mx  = me.tank.position[0], my = me.tank.position[1];
  var cur = me.tank.direction;
  var dirs = ["north","east","south","west"];
  var ddx  = [0, 1, 0, -1], ddy = [-1, 0, 1, 0];

  // 判断某方向下一格是否可通行
  function free(d) {
    var i = dirs.indexOf(d), nx = mx + ddx[i], ny = my + ddy[i];
    var row = game.map[ny];
    return !!(row && (row[nx] === "." || row[nx] === "o"));
  }

  // 最短路径转向，已对齐返回 false
  function turnTo(want) {
    if (cur === want) return false;
    var diff = (dirs.indexOf(want) - dirs.indexOf(cur) + 4) % 4;
    me.turn(diff <= 2 ? "right" : "left");
    return true;
  }

  // 朝目标坐标的最优方向
  function dirTo(tx, ty) {
    var dx = tx - mx, dy = ty - my;
    return Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? "east" : "west")
      : (dy > 0 ? "south" : "north");
  }

  // 1. 技能：冷却好立即触发
  if (me.skill.remainingCooldownFrames === 0) {
    var sk = me.skill.type;
    if      (sk === "shield")   me.shield();
    else if (sk === "freeze")   me.freeze();
    else if (sk === "stun")     me.stun();
    else if (sk === "overload") me.overload();
    else if (sk === "cloak")    me.cloak();
    else if (sk === "poison")   me.poison();
    else if (sk === "boost")    me.boost();
  }

  // 2. 捡最近星星（曼哈顿距离 < 7 格时优先追）
  var star = game.star;
  if (star) {
    var dist = Math.abs(star[0] - mx) + Math.abs(star[1] - my);
    if (dist < 7) {
      var want = dirTo(star[0], star[1]);
      if (!turnTo(want) && free(want)) { me.go(); return; }
    }
  }

  // 3. 无敌人 → 直行巡逻，遇墙右转
  if (!enemy) {
    if (free(cur)) me.go();
    else me.turn("right");
    return;
  }

  // 4. 有敌人 → 对齐 → 开火 → 推进
  var want = dirTo(enemy.tank.position[0], enemy.tank.position[1]);
  if (turnTo(want)) return;
  if (me.tank.shootCooldown === 0) me.fire();
  if (free(want)) me.go();
  else me.turn("right");
}`

interface TankSkin { svg?: string; description?: string }
interface Tank {
  agent_id: string
  agent_name: string
  created_at: string
  pvp_wins?: number
  pvp_losses?: number
  pvp_battles?: number
  elo?: number
  skin?: TankSkin
  version?: number
  skill_type?: string
}

const SKILLS = [
  { key: "shield",   emoji: "🛡", name: "Shield",   desc: "激活护盾，最多吸收 1 发子弹（3 帧有效窗口）",    cd: 32 },
  { key: "freeze",   emoji: "❄",  name: "Freeze",   desc: "冻结最近敌人 5 帧（命令保留不执行）",            cd: 32 },
  { key: "stun",     emoji: "⚡", name: "Stun",     desc: "眩晕最近敌人 5 帧（命令被随机替换）",            cd: 33 },
  { key: "overload", emoji: "🔥", name: "Overload", desc: "下次开炮发射双弹，造成双倍伤害",                 cd: 32 },
  { key: "cloak",    emoji: "👁", name: "Cloak",    desc: "隐身 6 帧，彻底消失于敌方传感器",                cd: 36 },
  { key: "poison",   emoji: "🧪", name: "Poison",   desc: "使最近敌人中毒 8 帧，其中 4 帧跳过命令",         cd: 30 },
  { key: "teleport", emoji: "🌀", name: "Teleport", desc: "瞬移到指定坐标（近敌时锁定射击 2 帧）",          cd: 35 },
  { key: "boost",    emoji: "🚀", name: "Boost",    desc: "加速 5 帧，每次移动 2 格",                       cd: 31 },
] as const
type SkillKey = typeof SKILLS[number]["key"]

/* ── Avatar ── */
function TankAvatar({ name, skin, size = 20 }: { name: string; skin?: TankSkin; size?: number }) {
  const initials = name.slice(0, 2).toUpperCase()
  const hue      = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  const color    = `hsl(${hue}, 70%, 60%)`
  const px       = size * 4
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full border-4 font-black text-white flex items-center justify-center"
      style={{
        width:       px,
        height:      px,
        fontSize:    px * 0.28,
        background:  `hsl(${hue}, 40%, ${skin?.svg ? 10 : 15}%)`,
        borderColor: color,
        boxShadow:   `0 0 16px ${color}60`,
      }}
    >
      {skin?.svg ? (
        <svg viewBox="-20 -14 40 28" width={px * 0.8} height={px * 0.55}
          dangerouslySetInnerHTML={{ __html: skin.svg }} />
      ) : initials}
    </div>
  )
}

/* ── Maximalism input ── */
function MaxInput({
  value, onChange, onKeyDown, placeholder, type = "text", disabled, autoFocus, accent,
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  autoFocus?: boolean
  accent: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className="w-full rounded-full border-4 bg-[#0D0D1A]/70 px-5 py-3 text-base font-bold text-white placeholder:text-white/25 outline-none transition-all duration-200 disabled:opacity-50"
      style={{ borderColor: `${accent}70` }}
      onFocus={e => { e.target.style.borderColor = accent; e.target.style.boxShadow = `0 0 14px ${accent}50` }}
      onBlur={e =>  { e.target.style.borderColor = `${accent}70`; e.target.style.boxShadow = "none" }}
    />
  )
}

/* ── Delete confirm overlay ── */
function DeleteConfirm({
  target, onCancel, onConfirm,
}: {
  target: { id: string; name: string }
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D1A]/85 px-4 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.92, y: 16  }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-md overflow-hidden rounded-3xl backdrop-blur-md"
        style={{
          background:  "rgba(45,27,78,0.9)",
          border:      "4px solid #FF6B35",
          boxShadow:   "8px 8px 0 #FF3AF2, 0 0 30px rgba(255,107,53,0.3)",
        }}
      >
        <div className="px-7 py-5" style={{ borderBottom: "4px dashed #FF6B35" }}>
          <h2
            className="text-2xl font-black uppercase tracking-tight text-white"
            style={{ textShadow: "2px 2px 0 #FF6B35" }}
          >
            删除坦克？
          </h2>
          <p className="mt-1 text-sm font-bold text-[#FF6B35]">「{target.name}」</p>
        </div>
        <div className="px-7 py-5">
          <p className="text-sm font-medium text-white/60">
            该坦克的全部历史版本、皮肤、Elo 与绑定密钥都会被清除（对战记录保留）。此操作不可撤销。
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 rounded-full border-4 border-dashed border-[#00F5D4] py-3 text-sm font-black uppercase tracking-widest text-[#00F5D4] transition-all duration-150 hover:bg-[#00F5D4]/10"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 rounded-full border-4 border-[#FF6B35] py-3 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-[1.02] active:scale-95"
              style={{
                background:  "linear-gradient(135deg, #FF6B35, #FF3AF2)",
                boxShadow:   "0 0 16px rgba(255,107,53,0.4), 3px 3px 0 #FF6B35",
              }}
            >
              确认删除
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Main content ── */
function TanksContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [tanks,    setTanks]    = useState<Tank[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const [credits,       setCredits]       = useState<number | null>(null)
  const [showNew,       setShowNew]       = useState(false)
  const [newName,       setNewName]       = useState("")
  const [skinDesc,      setSkinDesc]      = useState("")
  const [creating,      setCreating]      = useState(false)
  const [creatingStep,  setCreatingStep]  = useState<"" | "agent" | "skin">("")
  const [createError,   setCreateError]   = useState<string | null>(null)
  const [rerollingId,   setRerollingId]   = useState<string | null>(null)

  const [menuOpen,    setMenuOpen]    = useState<string | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (searchParams.get("new") === "1") setShowNew(true)
  }, [searchParams])

  useEffect(() => {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    fetch(`${apiBase}/api/my-tanks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setTanks).catch(() => setError("加载失败"))
      .finally(() => setLoading(false))
    fetch(`${apiBase}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setCredits(d.credits ?? null)).catch(() => {})
  }, [router])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  function openNew() { setShowNew(true); setCreateError(null); setNewName(""); setSkinDesc("") }
  function closeNew() { setShowNew(false); setCreateError(null) }

  function randomName() {
    const prefix = [
      "Iron","Steel","Shadow","Storm","Blaze","Void","Nova","Apex",
      "Titan","Ghost","Frost","Ember","Cyber","Hyper","Onyx","Venom",
      "Neon","Obsidian","Crimson","Zenith","Phantom","Quantum","Rogue","Inferno",
    ]
    const suffix = [
      "Strike","Runner","Guard","Hunter","Blade","Wolf","Hawk","Rex",
      "Zero","Prime","Core","Viper","Fang","Fury","Jet","Claw",
      "Shard","Pulse","Wraith","Talon","Spike","Bolt","Rift","Surge",
    ]
    const p = pick(prefix)
    const s = pick(suffix)
    setNewName(`${p}${s}`)
  }

  function randomSkin() {
    // 笛卡尔积：体型 × 涂装 × 表面细节 × 附加特征
    // 6 × 10 × 10 × 8 = 4800 种组合
    const bodies = [
      "重型装甲车体，宽履带",
      "低矮扁平的隐身车体",
      "高机动轻甲车体，细履带",
      "超重型突击车体，双层装甲板",
      "流线型战斗车体",
      "紧凑方正的突击车体",
    ]
    const colors = [
      "哑光深灰涂装",
      "橙红渐变火焰涂装",
      "北极白蓝迷彩",
      "沙漠卡其黄涂装",
      "迷彩绿褐三色",
      "哑光纯黑涂装",
      "黄铜金属光泽涂装",
      "赛博霓虹紫黑涂装",
      "枪铁灰磨砂涂装",
      "军绿橄榄色涂装",
    ]
    const details = [
      "带红色危险警示条纹",
      "覆满紫色电路板纹路",
      "布满铆钉与焊接痕",
      "有霓虹蓝发光条纹",
      "印白色骷髅徽标",
      "覆满做旧锈迹肌理",
      "带黄黑相间警戒斑纹",
      "刻有几何图形蚀刻纹",
      "印有骨骼X光图案",
      "带渐变能量裂纹光效",
    ]
    const extras = [
      "炮管带环形散热槽",
      "侧翼有推进喷口",
      "履带覆防护链甲",
      "顶部有折叠式天线",
      "车尾装甲板带尖刺",
      "炮塔侧面有附加护盾",
      "炮管超长且末端微弯",
      "车体四角有外挂装甲块",
    ]
    setSkinDesc(
      `${pick(bodies)}，${pick(colors)}${pick(details)}，${pick(extras)}`
    )
  }

  async function handleCreate() {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    if (!newName.trim()) { setCreateError("请输入坦克名称"); return }
    setCreating(true); setCreateError(null); setCreatingStep("agent")
    try {
      const res  = await fetch(`${apiBase}/api/agent`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ name: newName.trim(), code: DEFAULT_CODE }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "创建失败")
      if (typeof data.credits === "number") setCredits(data.credits)
      const desc = skinDesc.trim()
      if (desc) {
        setCreatingStep("skin")
        await fetch(`${apiBase}/api/tanks/${data.agent_id}/skin/generate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc }),
        }).catch(() => {})
      }
      router.push(`/tanks/${data.agent_id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败")
      setCreating(false); setCreatingStep("")
    }
  }

  async function handleReroll(tankId: string) {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    setRerollingId(tankId)
    try {
      const res  = await fetch(`${apiBase}/api/tanks/${tankId}/skill/reroll`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "抽取失败")
      setTanks(prev => prev.map(t =>
        t.agent_id === tankId ? { ...t, skill_type: data.skill_type } : t
      ))
      setCredits(data.credits)
    } catch (err) {
      setError(err instanceof Error ? err.message : "抽取失败")
    } finally {
      setRerollingId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const { id: tankId } = deleteTarget
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    setDeleteTarget(null); setMenuOpen(null); setDeletingId(tankId); setError(null)
    try {
      const res = await fetch(`${apiBase}/api/tanks/${tankId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `删除失败 ${res.status}`)
      }
      setTanks(prev => prev.filter(t => t.agent_id !== tankId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">

      {/* Background patterns */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      {/* Floating decorations */}
      <div className="animate-max-float pointer-events-none absolute top-[6%] right-[4%] select-none text-5xl" aria-hidden="true">🛡️</div>
      <div className="animate-max-bounce pointer-events-none absolute top-[14%] left-[3%] select-none text-4xl" aria-hidden="true">⚡</div>
      <div
        className="animate-max-spin-slow pointer-events-none absolute bottom-[8%] right-[5%] size-14 rounded-full"
        style={{ border: "4px solid #FF3AF2", opacity: 0.18 }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-3xl flex flex-col gap-8">

        {/* ── Header ── */}
        <div className="flex items-end justify-between">
          <div>
            <p className="mb-2 font-mono text-xs font-black uppercase tracking-[0.4em] text-[#FF3AF2]">
              // my arsenal
            </p>
            <h1
              className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
              style={{
                fontFamily: "var(--font-outfit)",
                textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
              }}
            >
              我的坦克
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {credits !== null && (
              <div
                className="flex items-center gap-2 rounded-full border-4 px-4 py-1.5"
                style={{ borderColor: "#FFE600", background: "rgba(255,230,0,0.1)", boxShadow: "0 0 12px rgba(255,230,0,0.25)" }}
              >
                <span className="text-sm">💎</span>
                <span className="font-mono text-sm font-black text-[#FFE600]">{credits}</span>
                <span className="text-xs font-black uppercase tracking-widest text-[#FFE600]/60">积分</span>
              </div>
            )}
            <motion.button
              onClick={openNew}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 rounded-full border-4 border-[#FFE600] px-6 py-3 text-sm font-black uppercase tracking-widest text-white"
              style={{
                background:  "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                boxShadow:   "0 0 20px rgba(255,58,242,0.4), 6px 6px 0 #FFE600",
              }}
            >
              <Plus className="size-4" />
              新建坦克
              {tanks.length > 0 && (
                <span className="ml-1 rounded-full bg-[#FFE600]/20 border border-[#FFE600]/50 px-2 py-0.5 text-[10px] font-black text-[#FFE600]">
                  💎 200
                </span>
              )}
            </motion.button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
            style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
          >
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center gap-3 py-20 justify-center">
            <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
            <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && tanks.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24">
            <span className="animate-max-bounce text-6xl" aria-hidden="true">🎯</span>
            <p className="text-sm font-black uppercase tracking-widest text-white/40">
              还没有坦克，点击「新建坦克」开始
            </p>
          </div>
        )}

        {/* ── Tank cards ── */}
        <div className="flex flex-col gap-6" ref={menuRef}>
          {tanks.map((tank, idx) => {
            const elo     = Math.round(tank.elo ?? 1000)
            const wins    = tank.pvp_wins    ?? 0
            const losses  = tank.pvp_losses  ?? 0
            const battles = tank.pvp_battles ?? 0
            const tier    = getEloTier(elo, battles)
            const winRate = battles > 0 ? Math.round((wins / battles) * 100) : 0
            const accent  = CARD_ACCENTS[idx % CARD_ACCENTS.length]
            const [sh1, sh2] = CARD_SHADOWS[idx % CARD_SHADOWS.length]
            const tilt    = idx % 2 === 0 ? "0.6deg" : "-0.6deg"

            return (
              <div key={tank.agent_id} style={{ transform: `rotate(${tilt})` }}>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0  }}
                  transition={{ duration: 0.3, delay: idx * 0.06 }}
                  whileHover={{ y: -6 }}
                  className="relative overflow-hidden rounded-3xl backdrop-blur-sm"
                  style={{
                    background:  "rgba(45,27,78,0.6)",
                    border:      `4px solid ${accent}`,
                    boxShadow:   `8px 8px 0 ${sh1}, 16px 16px 0 ${sh2}`,
                  }}
                >
                  {/* ⋯ context menu */}
                  <div className="absolute right-4 top-4 z-10">
                    <button
                      onClick={() => setMenuOpen(menuOpen === tank.agent_id ? null : tank.agent_id)}
                      className="rounded-full border-2 p-1.5 transition-all duration-150 hover:scale-110"
                      style={{
                        borderColor: `${accent}60`,
                        color:       accent,
                        background:  `${accent}12`,
                      }}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>

                    <AnimatePresence>
                      {menuOpen === tank.agent_id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, y: -6 }}
                          animate={{ opacity: 1, scale: 1,    y: 0  }}
                          exit={{   opacity: 0, scale: 0.92, y: -6  }}
                          transition={{ duration: 0.14 }}
                          className="absolute right-0 top-10 z-50 min-w-[152px] overflow-hidden rounded-2xl py-1"
                          style={{
                            background:  "#1A0D2E",
                            border:      `4px solid ${accent}`,
                            boxShadow:   `4px 4px 0 ${sh1}`,
                          }}
                        >
                          <button
                            onClick={() => { router.push(`/tanks/${tank.agent_id}`); setMenuOpen(null) }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-black uppercase tracking-wide text-white transition-colors duration-100 hover:bg-white/5"
                          >
                            <Pencil className="size-3.5" style={{ color: accent }} />
                            编辑代码
                          </button>
                          <div className="mx-3 my-1 border-t-2 border-dashed" style={{ borderColor: `${accent}40` }} />
                          <button
                            onClick={() => { setDeleteTarget({ id: tank.agent_id, name: tank.agent_name }); setMenuOpen(null) }}
                            disabled={deletingId === tank.agent_id}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-black uppercase tracking-wide text-[#FF6B35] transition-colors duration-100 hover:bg-[#FF6B35]/10 disabled:opacity-40"
                          >
                            {deletingId === tank.agent_id
                              ? <><Loader2 className="size-3.5 animate-spin" /> 删除中…</>
                              : <><Trash2 className="size-3.5" /> 删除</>}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Main info */}
                  <div className="flex gap-5 p-6">
                    <TankAvatar name={tank.agent_name} skin={tank.skin} size={20} />
                    <div className="flex flex-1 flex-col justify-center gap-2 min-w-0 pr-10">
                      <h3
                        className="truncate text-2xl font-black text-white"
                        style={{ textShadow: `1px 1px 0 ${accent}` }}
                      >
                        {tank.agent_name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1 rounded-full border-4 px-3 py-0.5 text-xs font-black uppercase tracking-wide"
                          style={{
                            borderColor: tier.color,
                            color:       tier.color,
                            background:  `${tier.color}18`,
                            boxShadow:   `0 0 8px ${tier.color}40`,
                          }}
                        >
                          <Shield className="size-3" />
                          {tier.label}
                        </span>
                        <span
                          className="rounded-full border-2 px-3 py-0.5 font-mono text-xs font-black"
                          style={{ borderColor: `${accent}50`, color: accent }}
                        >
                          Elo {elo}
                        </span>
                        {tank.skill_type && (() => {
                          const sk = SKILLS.find(s => s.key === tank.skill_type)
                          return sk ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                              style={{ borderColor: "rgba(255,230,0,0.4)", color: "#FFE600", background: "rgba(255,230,0,0.08)" }}
                            >
                              {sk.emoji} {sk.name}
                            </span>
                          ) : null
                        })()}
                        {tank.version != null && (
                          <span
                            className="inline-flex items-center rounded-full border-4 px-3 py-0.5 font-mono text-xs font-black uppercase tracking-wide"
                            style={{
                              borderColor: "#52525b",
                              color:       "#a1a1aa",
                              background:  "#52525b18",
                            }}
                          >
                            v{tank.version}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-white/45">
                        {battles === 0
                          ? "暂无对战 · 去竞技场打第一场吧"
                          : `${wins} 胜 ${losses} 负 · 胜率 ${winRate}%`}
                      </p>
                    </div>
                  </div>

                  {/* Action bar */}
                  <div
                    className="flex items-center gap-3 px-6 py-4"
                    style={{ borderTop: `4px dashed ${accent}50`, background: "rgba(13,13,26,0.4)" }}
                  >
                    <button
                      onClick={() => router.push(`/tanks/${tank.agent_id}`)}
                      className="rounded-full border-4 border-dashed px-5 py-2 text-sm font-black uppercase tracking-widest transition-all duration-150 hover:scale-105"
                      style={{ borderColor: accent, color: accent }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${accent}12` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                    >
                      详情
                    </button>
                    <button
                      onClick={() => handleReroll(tank.agent_id)}
                      disabled={rerollingId === tank.agent_id || (credits !== null && credits < 100)}
                      title={credits !== null && credits < 100 ? "积分不足（需 100）" : "花费 💎 100 积分随机抽取新技能"}
                      className="flex items-center gap-1.5 rounded-full border-4 border-dashed px-4 py-2 text-sm font-black uppercase tracking-widest transition-all duration-150 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: "#FFE600", color: "#FFE600" }}
                    >
                      {rerollingId === tank.agent_id
                        ? <><Loader2 className="size-3.5 animate-spin" /><span>抽取中</span></>
                        : <><Shuffle className="size-3.5" /><span>💎 100</span></>}
                    </button>
                    <button
                      onClick={() => router.push(`/race?tank=${tank.agent_id}`)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-full border-4 border-[#FFE600] py-2 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-[1.03] active:scale-95"
                      style={{
                        background:  "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                        boxShadow:   "0 0 12px rgba(255,58,242,0.35), 3px 3px 0 #FFE600",
                      }}
                    >
                      <Swords className="size-4" />
                      立即对战
                    </button>
                  </div>
                </motion.div>
              </div>
            )
          })}
        </div>
      </div>
    </main>

    {/* ── Create modal ── */}
    <AnimatePresence>
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D1A]/85 px-4 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) closeNew() }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.94, y: 20  }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-lg overflow-hidden rounded-3xl backdrop-blur-md"
            style={{
              background:  "rgba(45,27,78,0.92)",
              border:      "4px solid #7B2FFF",
              boxShadow:   "8px 8px 0 #00F5D4, 16px 16px 0 #FF3AF2, 0 0 40px rgba(123,47,255,0.3)",
            }}
          >
            {/* Modal header */}
            <div
              className="flex items-start justify-between gap-4 px-7 py-5"
              style={{ borderBottom: "4px solid #00F5D4", background: "rgba(13,13,26,0.4)" }}
            >
              <div>
                <h2
                  className="text-2xl font-black uppercase tracking-tight text-white"
                  style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #7B2FFF" }}
                >
                  创建坦克
                </h2>
                <p className="mt-1 text-sm font-medium text-white/50">
                  取名、描述外观，代码之后在详情页慢慢调。
                </p>
              </div>
              <button
                onClick={closeNew}
                className="shrink-0 rounded-full border-4 border-dashed border-[#FF3AF2]/60 p-1.5 text-[#FF3AF2] transition-all duration-150 hover:bg-[#FF3AF2]/10 hover:scale-110"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex flex-col gap-5 px-7 py-6">
              {/* Name */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-black uppercase tracking-widest text-[#FF3AF2]">坦克名称</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <MaxInput
                      value={newName}
                      onChange={v => { setNewName(v); setCreateError(null) }}
                      onKeyDown={e => e.key === "Enter" && handleCreate()}
                      placeholder="IronStrike、NovaHawk…"
                      autoFocus
                      accent="#FF3AF2"
                    />
                  </div>
                  <button
                    onClick={randomName}
                    title="随机生成"
                    className="rounded-full border-4 border-dashed border-[#FFE600] px-4 py-2 text-xs font-black uppercase tracking-widest text-[#FFE600] transition-all duration-150 hover:bg-[#FFE600]/10 hover:scale-105"
                  >
                    <Shuffle className="size-4" />
                  </button>
                </div>
              </div>

              {/* Skin description */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-widest text-[#00F5D4]">
                    坦克样式 <span className="font-medium normal-case tracking-normal text-white/30">（可选）</span>
                  </label>
                  <button
                    onClick={randomSkin}
                    disabled={creating}
                    title="随机生成样式"
                    className="rounded-full border-4 border-dashed border-[#00F5D4] px-3 py-1 text-xs font-black uppercase tracking-widest text-[#00F5D4] transition-all duration-150 hover:bg-[#00F5D4]/10 hover:scale-105 disabled:opacity-40"
                  >
                    <Shuffle className="size-3.5" />
                  </button>
                </div>
                <p className="text-xs text-white/35">
                  用一句话描述外观，AI 将生成专属 SVG 皮肤。留空可跳过。
                </p>
                <textarea
                  value={skinDesc}
                  onChange={e => setSkinDesc(e.target.value)}
                  placeholder="例如：重型工业风，厚装甲板，深灰涂装带红色警戒线…"
                  rows={3}
                  disabled={creating}
                  className="w-full resize-none rounded-2xl border-4 bg-[#0D0D1A]/70 px-5 py-3 text-sm font-bold text-white placeholder:text-white/25 outline-none transition-all duration-200 disabled:opacity-50"
                  style={{ borderColor: "rgba(0,245,212,0.5)" }}
                  onFocus={e => { e.target.style.borderColor = "#00F5D4"; e.target.style.boxShadow = "0 0 14px rgba(0,245,212,0.4)" }}
                  onBlur={e =>  { e.target.style.borderColor = "rgba(0,245,212,0.5)"; e.target.style.boxShadow = "none" }}
                />
              </div>

              {createError && (
                <div
                  className="rounded-xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
                  style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
                >
                  {createError}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-7 py-5" style={{ borderTop: "4px dashed #7B2FFF" }}>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-full border-4 border-[#FFE600] py-4 text-base font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-[1.02] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background:  "linear-gradient(135deg, #7B2FFF, #FF3AF2, #00F5D4)",
                  boxShadow:   creating ? "none" : "0 0 20px rgba(123,47,255,0.4), 4px 4px 0 #FFE600",
                }}
              >
                {creating ? (
                  <><Loader2 className="size-4 animate-spin" />{creatingStep === "skin" ? "生成皮肤中…" : "创建中…"}</>
                ) : tanks.length > 0 ? (
                  <span className="flex items-center gap-2">
                    创建坦克
                    <span className="rounded-full border-2 border-[#FFE600]/60 bg-[#FFE600]/15 px-2.5 py-0.5 text-xs font-black text-[#FFE600]">
                      💎 200 积分
                    </span>
                  </span>
                ) : "创建坦克（免费）"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* ── Delete confirm ── */}
    <AnimatePresence>
      {deleteTarget && (
        <DeleteConfirm
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </AnimatePresence>
    </>
  )
}

export default function TanksPage() {
  return (
    <Suspense>
      <TanksContent />
    </Suspense>
  )
}
