"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Copy, Check, User } from "lucide-react"
import { getCookie } from "@/lib/cookie"

interface UserProfile {
  id: string
  username: string
  email: string
  tank_count: number
  created_at: string
}

export default function SettingsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [copiedUid, setCopiedUid] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

  function getToken() {
    const t = getCookie("token")
    if (!t) { router.push("/login"); return null }
    return t
  }

  useEffect(() => {
    const token = getToken()
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    fetch(`${apiBase}/api/me`, { headers })
    .then(r => r.json())
    .then(p => setProfile(p))
    .catch(() => {
      setFetchError(true)
    }).finally(() => setLoading(false))
  }, [])

  function copyUserId() {
    if (!profile) return
    navigator.clipboard.writeText(profile.id)
    setCopiedUid(true)
    setTimeout(() => setCopiedUid(false), 2000)
  }

  const initials = profile?.username?.slice(0, 2).toUpperCase() ?? "??"

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 flex justify-center items-start pt-24">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
      </main>
    )
  }

  if (fetchError) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 flex flex-col items-center gap-4 pt-24">
        <p className="text-sm text-zinc-400">无法连接到 API 服务器</p>
        <Button variant="outline" onClick={() => { setFetchError(false); setLoading(true); window.location.reload() }} className="text-xs">
          重新加载
        </Button>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-white">账户中心</h1>
        <p className="mt-1 text-sm text-zinc-500">查看你的账户资料</p>
      </div>

      {/* 用户资料卡 */}
      <Card className="border-zinc-800 bg-zinc-900 ring-0">
        <CardContent className="flex items-center gap-4 py-5">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-blue-700 text-lg font-black text-white select-none">
            {initials}
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-lg font-bold text-white">{profile?.username}</span>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs text-zinc-500 truncate">
                {profile?.id ? `usr_${profile.id.replace(/-/g, "").slice(0, 16)}` : "—"}
              </code>
              <button
                onClick={copyUserId}
                className="shrink-0 rounded px-2 py-0.5 text-xs text-zinc-500 border border-zinc-700 hover:border-zinc-500 hover:text-white transition-colors flex items-center gap-1"
              >
                {copiedUid ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
                {copiedUid ? "已复制" : "复制 ID"}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 账户信息 */}
      <Card className="border-zinc-800 bg-zinc-900 ring-0">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-white">
            <User className="size-4 text-zinc-400" />
            账户信息
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-0 p-0">
          {[
            { label: "EMAIL",  value: profile?.email ?? "—" },
            { label: "TANKS",  value: String(profile?.tank_count ?? 0) },
            { label: "注册时间", value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString("zh-CN") : "—" },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? "border-b border-zinc-800" : ""}`}
            >
              <span className="text-xs font-semibold tracking-wider text-zinc-500">{row.label}</span>
              <span className="text-sm text-zinc-200">{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}
