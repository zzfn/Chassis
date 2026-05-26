"use client"

import { Suspense, useState, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { Mail, RefreshCw, Loader2 } from "lucide-react"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"
const COOLDOWN = 60

function Content() {
  const email = useSearchParams().get("email") ?? ""

  const [resending,  setResending]  = useState(false)
  const [resent,     setResent]     = useState(false)
  const [resendErr,  setResendErr]  = useState<string | null>(null)
  const [countdown,  setCountdown]  = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startCooldown() {
    setCountdown(COOLDOWN)
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0 }
        return c - 1
      })
    }, 1000)
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  async function handleResend() {
    if (!email || resending || countdown > 0) return
    setResending(true); setResendErr(null); setResent(false)
    try {
      const res  = await fetch(`${apiBase}/api/resend-verification`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "发送失败")
      setResent(true)
      startCooldown()
    } catch (e) {
      setResendErr(e instanceof Error ? e.message : "发送失败")
    } finally {
      setResending(false)
    }
  }

  const canResend = !resending && countdown === 0

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0D0D1A] px-4 py-16">

      {/* 背景纹理 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-mesh" />

      {/* 装饰元素 */}
      <div className="animate-max-float pointer-events-none absolute top-[10%] left-[7%] select-none text-5xl" aria-hidden="true">📬</div>
      <div className="animate-max-float-reverse pointer-events-none absolute top-[14%] right-[9%] select-none text-4xl" aria-hidden="true">✉️</div>
      <div className="animate-max-wiggle pointer-events-none absolute bottom-[14%] left-[10%] select-none text-3xl" aria-hidden="true">⭐</div>
      <div
        className="animate-max-spin-slow pointer-events-none absolute bottom-[22%] right-[8%] size-16 rounded-full"
        style={{ border: "4px solid #00F5D4", opacity: 0.2 }}
        aria-hidden="true"
      />
      <div
        className="animate-max-float-slow pointer-events-none absolute top-[38%] left-[4%] size-10 rounded-xl"
        style={{ background: "#7B2FFF", opacity: 0.18 }}
        aria-hidden="true"
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.96 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md overflow-hidden rounded-3xl backdrop-blur-md"
        style={{
          background: "rgba(45,27,78,0.88)",
          border:     "4px solid #00F5D4",
          boxShadow:  "8px 8px 0 #7B2FFF, 16px 16px 0 #FF3AF2, 0 0 40px rgba(0,245,212,0.25)",
          transform:  "rotate(-0.8deg)",
        }}
      >
        {/* Header */}
        <div
          className="px-8 py-6 text-center"
          style={{ borderBottom: "4px solid #7B2FFF", background: "rgba(13,13,26,0.5)" }}
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1,   opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(135deg, rgba(0,245,212,0.15), rgba(123,47,255,0.15))",
              border:     "4px solid #00F5D4",
              boxShadow:  "0 0 24px rgba(0,245,212,0.35), inset 0 0 20px rgba(0,245,212,0.08)",
            }}
          >
            <Mail className="size-9 text-[#00F5D4]" />
          </motion.div>
          <h1
            className="text-2xl font-black uppercase tracking-tight text-white"
            style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #00F5D4" }}
          >
            查收邮件
          </h1>
          <p className="mt-1 text-sm font-medium text-white/50">
            验证链接已发出，点击完成注册
          </p>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 p-8 text-center">
          {email && (
            <div
              className="rounded-2xl px-5 py-4"
              style={{ background: "rgba(0,245,212,0.06)", border: "2px dashed rgba(0,245,212,0.35)" }}
            >
              <p className="text-xs font-black uppercase tracking-widest text-[#00F5D4]">发送至</p>
              <p className="mt-1 break-all text-base font-black text-white">{email}</p>
            </div>
          )}

          <p className="text-sm font-medium leading-relaxed text-white/45">
            点击邮件中的链接即可完成注册并自动登录。
            <br />链接 <span className="font-black text-white/70">24 小时</span>内有效。
          </p>

          {/* 重发反馈 */}
          {resent && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl px-4 py-3 text-sm font-bold text-[#00F5D4]"
              style={{ border: "3px solid rgba(0,245,212,0.5)", background: "rgba(0,245,212,0.07)" }}
            >
              ✓ 已重新发送！
            </motion.div>
          )}
          {resendErr && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
              style={{ border: "3px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
            >
              {resendErr}
            </motion.div>
          )}

          {/* 重发按钮 */}
          <button
            onClick={handleResend}
            disabled={!canResend || !email}
            className="flex w-full items-center justify-center gap-2 rounded-full border-4 border-dashed py-3 text-sm font-black uppercase tracking-widest transition-all duration-150 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: "#7B2FFF", color: "#7B2FFF" }}
          >
            {resending ? (
              <><Loader2 className="size-4 animate-spin" />发送中…</>
            ) : countdown > 0 ? (
              <><RefreshCw className="size-4" />重新发送（{countdown}s）</>
            ) : (
              <><RefreshCw className="size-4" />重新发送</>
            )}
          </button>

          <p className="text-xs text-white/30">
            没收到？请检查垃圾邮件文件夹，或{" "}
            <Link
              href="/register"
              className="font-black text-[#FF3AF2] transition-all hover:text-[#FFE600] hover:underline"
            >
              重新注册
            </Link>
          </p>
        </div>
      </motion.div>
    </main>
  )
}

export default function VerifyEmailSentPage() {
  return <Suspense><Content /></Suspense>
}
