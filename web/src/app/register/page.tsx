"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { setCookie } from "@/lib/cookie"

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm]   = useState("")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!username.trim() || !email.trim() || !password) {
      setError("所有字段均为必填")
      return
    }
    if (password.length < 8) {
      setError("密码至少 8 位")
      return
    }
    if (password !== confirm) {
      setError("两次密码输入不一致")
      return
    }

    setLoading(true)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"
      const res = await fetch(`${apiBase}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "注册失败")
        return
      }
      setCookie("token", data.token)
      setCookie("username", data.username)
      router.push("/tanks?new=1")
    } catch {
      setError("无法连接到服务器，请检查后端是否已启动")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-4 py-16">
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900 ring-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl text-white">注册</CardTitle>
          <CardDescription className="text-zinc-400">
            创建你的 Chassis 账户，参与 AI 坦克对战
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-sm font-medium text-zinc-300">
                用户名
              </label>
              <Input
                id="username"
                type="text"
                placeholder="TankMaster_42"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-zinc-300">
                邮箱
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-zinc-300">
                密码
              </label>
              <Input
                id="password"
                type="password"
                placeholder="至少 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm" className="text-sm font-medium text-zinc-300">
                确认密码
              </label>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="mt-1 w-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-70"
            >
              {loading ? <><Loader2 className="mr-2 size-4 animate-spin" />创建中...</> : "创建账户"}
            </Button>
            <p className="text-center text-sm text-zinc-500">
              已有账户？{" "}
              <Link href="/login" className="text-blue-400 hover:text-blue-300 hover:underline">
                立即登录
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
