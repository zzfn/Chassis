"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Loader2, Swords } from "lucide-react"
import { getCookie, setCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (getCookie("token")) router.replace("/tanks")
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) { setError("请填写邮箱和密码"); return }
    setLoading(true)
    try {
      const res  = await fetch(`${apiBase}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "登录失败"); return }
      setCookie("token",    data.token)
      setCookie("username", data.username)
      setCookie("user_id",  data.user_id)
      router.push("/tanks")
    } catch {
      setError("无法连接到服务器，请检查后端是否已启动")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0D0D1A] px-4 py-16">

      {/* Background patterns */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.10]" />
      <div className="pointer-events-none absolute inset-0 pattern-mesh" />

      {/* Floating shapes */}
      <div className="animate-max-float pointer-events-none absolute top-[10%] left-[8%] select-none text-5xl" aria-hidden="true">⚡</div>
      <div className="animate-max-float-reverse pointer-events-none absolute top-[15%] right-[10%] select-none text-4xl" aria-hidden="true">✨</div>
      <div className="animate-max-bounce pointer-events-none absolute bottom-[15%] left-[12%] select-none text-4xl" aria-hidden="true">🎯</div>
      <div
        className="animate-max-spin-slow pointer-events-none absolute bottom-[20%] right-[10%] size-20 rounded-full"
        style={{ border: "4px solid #FFE600", opacity: 0.2 }}
        aria-hidden="true"
      />
      <div
        className="animate-max-float-slow pointer-events-none absolute top-[40%] left-[4%] size-12 rounded-xl"
        style={{ border: "4px dashed #7B2FFF", opacity: 0.25 }}
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
          border: "4px solid #FF3AF2",
          boxShadow: "8px 8px 0 #FFE600, 16px 16px 0 #7B2FFF, 0 0 40px rgba(255,58,242,0.3)",
          transform: "rotate(-1deg)",
        }}
      >
        {/* Header stripe */}
        <div
          className="px-8 py-6"
          style={{ borderBottom: "4px solid #FFE600", background: "rgba(13,13,26,0.5)" }}
        >
          <div className="flex items-center gap-3">
            <Swords className="size-6 text-[#FF3AF2] animate-max-wiggle" aria-hidden="true" />
            <h1
              className="text-gradient-max text-3xl font-black uppercase tracking-tight"
              style={{ fontFamily: "var(--font-outfit)" }}
            >
              登录
            </h1>
          </div>
          <p className="mt-1 text-sm font-medium text-white/50">
            登录你的 DeepTank 账户，开始 AI 坦克对战
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-8">

          <FormField label="邮箱" accent="#00F5D4">
            <MaxInput
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              accent="#00F5D4"
            />
          </FormField>

          <FormField label="密码" accent="#7B2FFF">
            <MaxInput
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              accent="#7B2FFF"
            />
          </FormField>

          {error && <ErrorBox>{error}</ErrorBox>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex w-full items-center justify-center rounded-full border-4 border-[#FFE600] py-4 text-base font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #FF3AF2, #7B2FFF, #00F5D4)",
              boxShadow: "0 0 20px rgba(255,58,242,0.4), 4px 4px 0 #FFE600",
            }}
          >
            {loading ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />登录中...</>
            ) : "登录"}
          </button>

          <p className="text-center text-sm font-medium text-white/40">
            还没有账户？{" "}
            <Link
              href="/register"
              className="font-black text-[#00F5D4] transition-all duration-150 hover:underline hover:text-[#FFE600]"
            >
              立即注册
            </Link>
          </p>
        </form>
      </motion.div>
    </main>
  )
}

/* ── Shared sub-components ── */

function FormField({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label
        className="text-xs font-black uppercase tracking-widest"
        style={{ color: accent }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function MaxInput({
  id,
  type,
  placeholder,
  value,
  onChange,
  accent,
}: {
  id: string
  type: string
  placeholder: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  accent: string
}) {
  return (
    <input
      id={id}
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      autoComplete={type === "email" ? "email" : type === "password" ? "current-password" : "off"}
      className="w-full rounded-full border-4 bg-[#0D0D1A]/70 px-6 py-3.5 text-base font-bold text-white placeholder:text-white/25 outline-none transition-all duration-200"
      style={{
        borderColor: `${accent}80`,
        boxShadow: `0 0 0 0px ${accent}40`,
      }}
      onFocus={e => {
        e.target.style.borderColor = accent
        e.target.style.boxShadow   = `0 0 15px ${accent}50, 0 0 0 2px ${accent}30`
      }}
      onBlur={e => {
        e.target.style.borderColor = `${accent}80`
        e.target.style.boxShadow   = `0 0 0 0px ${accent}40`
      }}
    />
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
      style={{
        border: "4px dashed #FF6B35",
        background: "rgba(255,107,53,0.08)",
      }}
    >
      {children}
    </div>
  )
}
