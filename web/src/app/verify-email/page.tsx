"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import { setCookie } from "@/lib/cookie"
import Link from "next/link"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

function Content() {
  const router = useRouter()
  const token  = useSearchParams().get("token")
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [errMsg, setErrMsg] = useState("")

  useEffect(() => {
    if (!token) { setStatus("error"); setErrMsg("链接中缺少验证码，请检查邮件中的链接是否完整"); return }
    fetch(`${apiBase}/api/verify-email?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.error ?? "验证失败")
        setCookie("token",    data.token)
        setCookie("username", data.username)
        setStatus("success")
        setTimeout(() => router.push("/tanks?new=1"), 2000)
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : "验证失败"
        // 网络错误时给出更具体的提示
        const isNetworkErr = msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror")
        setErrMsg(isNetworkErr ? "无法连接到服务器，请稍后重试" : msg)
        setStatus("error")
      })
  }, [token, router])

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0D0D1A] px-4 py-16">

      {/* 背景纹理 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-mesh" />

      {/* 装饰元素（仅在 loading 以外显示） */}
      {status !== "loading" && (
        <>
          <div className="animate-max-float pointer-events-none absolute top-[10%] left-[7%] select-none text-5xl" aria-hidden="true">
            {status === "success" ? "🎉" : "⚠️"}
          </div>
          <div className="animate-max-float-reverse pointer-events-none absolute top-[14%] right-[9%] select-none text-4xl" aria-hidden="true">
            {status === "success" ? "🚀" : "🔧"}
          </div>
        </>
      )}
      <div
        className="animate-max-spin-slow pointer-events-none absolute bottom-[22%] right-[8%] size-16 rounded-full"
        style={{ border: `4px solid ${status === "error" ? "#FF6B35" : "#00F5D4"}`, opacity: 0.2 }}
        aria-hidden="true"
      />
      <div
        className="animate-max-float-slow pointer-events-none absolute top-[38%] left-[4%] size-10 rounded-xl"
        style={{ background: status === "error" ? "#FF3AF2" : "#7B2FFF", opacity: 0.18 }}
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
          border:     `4px solid ${status === "error" ? "#FF6B35" : "#00F5D4"}`,
          boxShadow:  status === "error"
            ? "8px 8px 0 #FF3AF2, 0 0 40px rgba(255,107,53,0.3)"
            : "8px 8px 0 #7B2FFF, 16px 16px 0 #FF3AF2, 0 0 40px rgba(0,245,212,0.25)",
          transform:  "rotate(-0.8deg)",
        }}
      >
        {/* Header */}
        <div
          className="px-8 py-6 text-center"
          style={{ borderBottom: `4px solid ${status === "error" ? "#FF3AF2" : "#7B2FFF"}`, background: "rgba(13,13,26,0.5)" }}
        >
          <AnimatePresence mode="wait">
            {status === "loading" && (
              <motion.div key="loading"
                initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
                className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full"
                style={{
                  background: "linear-gradient(135deg, rgba(0,245,212,0.12), rgba(123,47,255,0.12))",
                  border:     "4px solid #00F5D4",
                  boxShadow:  "0 0 24px rgba(0,245,212,0.3)",
                }}
              >
                <Loader2 className="size-9 animate-spin text-[#00F5D4]" />
              </motion.div>
            )}
            {status === "success" && (
              <motion.div key="success"
                initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full"
                style={{
                  background: "linear-gradient(135deg, rgba(0,245,212,0.2), rgba(123,47,255,0.15))",
                  border:     "4px solid #00F5D4",
                  boxShadow:  "0 0 30px rgba(0,245,212,0.4), inset 0 0 20px rgba(0,245,212,0.1)",
                }}
              >
                <CheckCircle className="size-9 text-[#00F5D4]" />
              </motion.div>
            )}
            {status === "error" && (
              <motion.div key="error"
                initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full"
                style={{
                  background: "linear-gradient(135deg, rgba(255,107,53,0.2), rgba(255,58,242,0.1))",
                  border:     "4px solid #FF6B35",
                  boxShadow:  "0 0 24px rgba(255,107,53,0.35)",
                }}
              >
                <XCircle className="size-9 text-[#FF6B35]" />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {status === "loading" && (
              <motion.div key="t-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h1
                  className="text-2xl font-black uppercase tracking-tight text-white"
                  style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #00F5D4" }}
                >
                  验证中
                </h1>
                <p className="mt-1 text-sm font-medium text-white/50">正在确认你的邮箱…</p>
              </motion.div>
            )}
            {status === "success" && (
              <motion.div key="t-success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <h1
                  className="text-2xl font-black uppercase tracking-tight text-white"
                  style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #00F5D4" }}
                >
                  验证成功！
                </h1>
                <p className="mt-1 text-sm font-medium text-white/50">即将跳转到坦克库…</p>
              </motion.div>
            )}
            {status === "error" && (
              <motion.div key="t-error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <h1
                  className="text-2xl font-black uppercase tracking-tight text-white"
                  style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #FF6B35" }}
                >
                  验证失败
                </h1>
                <p className="mt-1 text-sm font-medium text-white/50">链接可能已失效</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-8 text-center">
          <AnimatePresence mode="wait">
            {status === "loading" && (
              <motion.p key="b-loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-sm font-medium text-white/40"
              >
                请稍候，正在与服务器通信…
              </motion.p>
            )}
            {status === "success" && (
              <motion.div key="b-success"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4"
              >
                <div
                  className="rounded-2xl px-5 py-4"
                  style={{ background: "rgba(0,245,212,0.07)", border: "2px dashed rgba(0,245,212,0.35)" }}
                >
                  <p className="text-sm font-bold text-white/70">
                    🎉 欢迎加入 DeepTank！创建你的第一辆 AI 坦克，投入战场！
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <div className="size-2 animate-bounce rounded-full bg-[#00F5D4]" style={{ animationDelay: "0ms" }} />
                  <div className="size-2 animate-bounce rounded-full bg-[#7B2FFF]" style={{ animationDelay: "150ms" }} />
                  <div className="size-2 animate-bounce rounded-full bg-[#FF3AF2]" style={{ animationDelay: "300ms" }} />
                </div>
              </motion.div>
            )}
            {status === "error" && (
              <motion.div key="b-error"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4"
              >
                <div
                  className="rounded-xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
                  style={{ border: "3px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
                >
                  {errMsg}
                </div>
                <p className="text-xs text-white/35">
                  链接仅限使用一次，且 24 小时后过期。
                </p>
                <Link
                  href="/register"
                  className="flex w-full items-center justify-center rounded-full border-4 border-[#FF3AF2] py-3.5 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-[1.02] active:scale-95"
                  style={{
                    background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                    boxShadow:  "0 0 20px rgba(255,58,242,0.35), 4px 4px 0 #FFE600",
                  }}
                >
                  重新注册
                </Link>
                <Link
                  href="/login"
                  className="text-sm font-bold text-white/40 transition-all hover:text-white/70"
                >
                  已有账户？登录
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </main>
  )
}

export default function VerifyEmailPage() {
  return <Suspense><Content /></Suspense>
}
