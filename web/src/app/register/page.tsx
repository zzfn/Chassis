"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Loader2, Rocket } from "lucide-react"
import { setCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

const FIELDS = [
  { id: "username", label: "用户名",  type: "text",     placeholder: "TankMaster_42",  accent: "#FF3AF2",  autocomplete: "username"        },
  { id: "email",    label: "邮箱",    type: "email",    placeholder: "you@example.com", accent: "#00F5D4",  autocomplete: "email"           },
  { id: "password", label: "密码",    type: "password", placeholder: "至少 8 位",        accent: "#7B2FFF",  autocomplete: "new-password"    },
  { id: "confirm",  label: "确认密码", type: "password", placeholder: "••••••••",        accent: "#FF6B35",  autocomplete: "new-password"    },
]

export default function RegisterPage() {
  const router = useRouter()
  const [values, setValues] = useState({ username: "", email: "", password: "", confirm: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function set(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setValues(v => ({ ...v, [key]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const { username, email, password, confirm } = values
    if (!username.trim() || !email.trim() || !password) { setError("所有字段均为必填"); return }
    if (password.length < 8)          { setError("密码至少 8 位"); return }
    if (password !== confirm)          { setError("两次密码输入不一致"); return }

    setLoading(true)
    try {
      const res  = await fetch(`${apiBase}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "注册失败"); return }
      setCookie("token",    data.token)
      setCookie("username", data.username)
      router.push("/tanks?new=1")
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
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      {/* Floating shapes */}
      <div className="animate-max-float pointer-events-none absolute top-[8%] left-[6%] select-none text-5xl" aria-hidden="true">🚀</div>
      <div className="animate-max-float-reverse pointer-events-none absolute top-[12%] right-[8%] select-none text-4xl" aria-hidden="true">⭐</div>
      <div className="animate-max-wiggle pointer-events-none absolute bottom-[12%] right-[12%] select-none text-4xl" aria-hidden="true">💥</div>
      <div
        className="animate-max-spin-slow pointer-events-none absolute top-[35%] left-[3%] size-16 rounded-full"
        style={{ border: "4px solid #FF3AF2", opacity: 0.2 }}
        aria-hidden="true"
      />
      <div
        className="animate-max-float-slow pointer-events-none absolute bottom-[25%] right-[5%] size-10 rounded-xl"
        style={{ background: "#FFE600", opacity: 0.15 }}
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
          border: "4px solid #7B2FFF",
          boxShadow: "8px 8px 0 #00F5D4, 16px 16px 0 #FF3AF2, 0 0 40px rgba(123,47,255,0.3)",
          transform: "rotate(1deg)",
        }}
      >
        {/* Header stripe */}
        <div
          className="px-8 py-6"
          style={{ borderBottom: "4px solid #00F5D4", background: "rgba(13,13,26,0.5)" }}
        >
          <div className="flex items-center gap-3">
            <Rocket className="size-6 animate-max-bounce" style={{ color: "#7B2FFF" }} aria-hidden="true" />
            <h1
              className="text-3xl font-black uppercase tracking-tight"
              style={{
                fontFamily: "var(--font-outfit)",
                background: "linear-gradient(90deg, #7B2FFF, #00F5D4, #FF3AF2)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              注册
            </h1>
          </div>
          <p className="mt-1 text-sm font-medium text-white/50">
            创建你的 DeepTank 账户，参与 AI 坦克对战
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-8">
          {FIELDS.map((f, i) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.05 * i }}
              className="flex flex-col gap-2"
            >
              <label
                htmlFor={f.id}
                className="text-xs font-black uppercase tracking-widest"
                style={{ color: f.accent }}
              >
                {f.label}
              </label>
              <input
                id={f.id}
                type={f.type}
                placeholder={f.placeholder}
                value={values[f.id as keyof typeof values]}
                onChange={set(f.id)}
                autoComplete={f.autocomplete}
                className="w-full rounded-full border-4 bg-[#0D0D1A]/70 px-6 py-3 text-base font-bold text-white placeholder:text-white/25 outline-none transition-all duration-200"
                style={{ borderColor: `${f.accent}70` }}
                onFocus={e => {
                  e.target.style.borderColor = f.accent
                  e.target.style.boxShadow   = `0 0 15px ${f.accent}50, 0 0 0 2px ${f.accent}30`
                }}
                onBlur={e => {
                  e.target.style.borderColor = `${f.accent}70`
                  e.target.style.boxShadow   = "none"
                }}
              />
            </motion.div>
          ))}

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
              style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center rounded-full border-4 border-[#00F5D4] py-4 text-base font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #7B2FFF, #FF3AF2, #00F5D4)",
              boxShadow: "0 0 20px rgba(123,47,255,0.4), 4px 4px 0 #00F5D4",
            }}
          >
            {loading ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />创建中...</>
            ) : "创建账户"}
          </button>

          <p className="text-center text-sm font-medium text-white/40">
            已有账户？{" "}
            <Link
              href="/login"
              className="font-black text-[#FF3AF2] transition-all duration-150 hover:underline hover:text-[#FFE600]"
            >
              立即登录
            </Link>
          </p>
        </form>
      </motion.div>
    </main>
  )
}
