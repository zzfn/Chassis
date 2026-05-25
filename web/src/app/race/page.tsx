"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Zap } from "lucide-react"
import { getCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

interface MyTank { agent_id: string; agent_name: string }

function RaceContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [mode,           setMode]           = useState<"1v1" | "2v2">("1v1")
  const [myTanks,        setMyTanks]        = useState<MyTank[]>([])
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null)
  const [battling,       setBattling]       = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    fetch(`${apiBase}/api/my-tanks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((tanks: MyTank[]) => {
        setMyTanks(tanks)
        const paramTank = searchParams.get("tank")
        const match = tanks.find(t => t.agent_id === paramTank)
        if (match) setSelectedTankId(match.agent_id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [searchParams])

  async function startMatch() {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    if (!selectedTankId) { setError("请先选择出战坦克"); return }
    setBattling(true)
    setError(null)
    try {
      const endpoint = mode === "2v2" ? `${apiBase}/api/matchmake/2v2` : `${apiBase}/api/matchmake`
      const res  = await fetch(endpoint, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "匹配失败")
      router.push(`/replay/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "匹配失败")
      setBattling(false)
    }
  }

  const selectedTank = myTanks.find(t => t.agent_id === selectedTankId) ?? null
  const ready        = !!selectedTank && !battling

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#0D0D1A] px-4 py-16">

      {/* ── 背景 ── */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-56 opacity-[0.12]"
        style={{
          backgroundImage: [
            "linear-gradient(transparent 94%, #FF3AF2 94%)",
            "linear-gradient(90deg, transparent 94%, #FF3AF2 94%)",
          ].join(", "),
          backgroundSize: "36px 36px",
          transform: "perspective(350px) rotateX(55deg) translateY(50px) scale(2.5)",
          transformOrigin: "bottom center",
          maskImage: "linear-gradient(to top, black 5%, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to top, black 5%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 size-[600px] opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, #FF3AF2 0%, #7B2FFF 45%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-10">

        {/* ── 标题 ── */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-2 text-center"
        >
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.5em]" style={{ color: "#00F5D4" }}>
            &gt; MATCHMAKING.SYS
          </p>
          <h1
            className="text-5xl font-black uppercase tracking-tighter text-white"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "3px 3px 0 #7B2FFF, 6px 6px 0 #FF3AF2",
            }}
          >
            对战匹配
          </h1>
        </motion.div>

        {/* ── 模式切换 ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
          className="flex gap-3 w-full"
        >
          {(["1v1", "2v2"] as const).map((m) => {
            const active = mode === m
            return (
              <motion.button
                key={m}
                onClick={() => { setMode(m); setError(null) }}
                whileTap={{ scale: 0.95 }}
                className="-skew-x-6 flex-1 py-2.5 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 hover:skew-x-0"
                style={{
                  border:     `2px ${active ? "solid" : "dashed"} ${active ? "#00F5D4" : "rgba(255,255,255,0.2)"}`,
                  background: active ? "#00F5D4" : "transparent",
                  color:      active ? "#000" : "rgba(255,255,255,0.3)",
                  boxShadow:  active ? "0 0 14px rgba(0,245,212,0.35)" : "none",
                }}
              >
                <span className="inline-block skew-x-6">{m}</span>
              </motion.button>
            )
          })}
        </motion.div>

        {/* ── 坦克选择 ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="w-full overflow-hidden"
          style={{
            border:     "2px solid rgba(255,58,242,0.35)",
            borderTop:  "2px solid #FF3AF2",
            background: "rgba(0,0,0,0.6)",
            boxShadow:  "0 0 20px rgba(255,58,242,0.1)",
          }}
        >
          {/* 标题栏 */}
          <div
            className="flex items-center gap-3 px-4 py-2 border-b-2"
            style={{ background: "rgba(255,58,242,0.06)", borderColor: "#FF3AF2" }}
          >
            <span className="flex gap-1.5">
              {["#FF3AF2", "#FFE600", "#00F5D4"].map(c => (
                <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
              ))}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: "#FF3AF2" }}>
              SELECT_UNIT.DAT
            </span>
          </div>

          <div className="p-5">
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" style={{ color: "#FF3AF2" }} />
                <span className="font-mono text-xs text-white/30 uppercase tracking-wider">LOADING...</span>
              </div>
            ) : myTanks.length === 0 ? (
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-white/30 uppercase tracking-wider">无可用坦克 —</span>
                <button
                  onClick={() => router.push("/tanks")}
                  className="font-mono text-xs uppercase tracking-wider underline"
                  style={{ color: "#FF3AF2" }}
                >
                  去创建
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {myTanks.map(t => {
                  const active = selectedTankId === t.agent_id
                  return (
                    <motion.button
                      key={t.agent_id}
                      onClick={() => setSelectedTankId(active ? null : t.agent_id)}
                      whileTap={{ scale: 0.95 }}
                      className="-skew-x-6 px-5 py-2 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 hover:skew-x-0"
                      style={{
                        border:     `2px solid ${active ? "#FF3AF2" : "rgba(255,58,242,0.3)"}`,
                        background: active ? "rgba(255,58,242,0.15)" : "transparent",
                        color:      active ? "#FF3AF2" : "rgba(255,255,255,0.4)",
                        boxShadow:  active ? "0 0 14px rgba(255,58,242,0.35)" : "none",
                      }}
                    >
                      <span className="inline-block skew-x-6">{t.agent_name}</span>
                    </motion.button>
                  )
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* ── 开战按钮 ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.18 }}
          className="w-full"
        >
          <motion.button
            onClick={startMatch}
            disabled={!ready}
            whileHover={ready ? { scale: 1.02 } : {}}
            whileTap={ready  ? { scale: 0.97 } : {}}
            className="relative w-full -skew-x-3 overflow-hidden font-mono font-black uppercase transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-25"
            style={{
              height:     64,
              border:     "2px solid #FFE600",
              background: ready
                ? "linear-gradient(135deg, #FF3AF2 0%, #7B2FFF 50%, #FF3AF2 100%)"
                : "rgba(255,230,0,0.05)",
              backgroundSize: "200% 100%",
              color:      "#FFE600",
              letterSpacing: "0.35em",
              fontSize:   15,
              boxShadow:  ready
                ? "0 0 30px rgba(255,58,242,0.45), 0 0 60px rgba(255,58,242,0.15), inset 0 0 24px rgba(255,230,0,0.06)"
                : "none",
            }}
          >
            <span className="inline-flex items-center gap-3 skew-x-3">
              <AnimatePresence mode="wait">
                {battling ? (
                  <motion.span
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2.5"
                  >
                    <Loader2 className="size-4 animate-spin" />
                    MATCHING...
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
                    ENGAGE
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.button>

          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-white/20">
            {mode === "2v2" ? "系统将自动匹配队友与对手" : "系统将根据 Elo 自动匹配对手"}
          </p>
        </motion.div>

        {/* ── 错误提示 ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full flex items-center gap-3 px-4 py-3"
              style={{ border: "2px dashed #FF6B35", background: "rgba(255,107,53,0.07)" }}
            >
              <span className="font-mono text-xs font-black" style={{ color: "#FF6B35" }}>[ERR]</span>
              <span className="font-mono text-xs text-white/55">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  )
}

export default function ArenaPage() {
  return (
    <Suspense>
      <RaceContent />
    </Suspense>
  )
}
