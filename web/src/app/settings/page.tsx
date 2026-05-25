"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Plus, Trash2, Copy, Check } from "lucide-react"
import { getCookie } from "@/lib/cookie"

interface ApiKey {
  id: string
  name: string
  key: string
  created_at: string
}

export default function SettingsPage() {
  const router = useRouter()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

  function getToken() {
    const t = getCookie("token")
    if (!t) { router.push("/login"); return null }
    return t
  }

  async function fetchKeys() {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`${apiBase}/api/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error("加载失败")
      setKeys(await res.json())
    } catch {
      setError("无法加载 API 密钥")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchKeys() }, [])

  async function handleCreate() {
    const token = getToken()
    if (!token) return
    if (!newName.trim()) { setError("请输入密钥名称"); return }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/keys`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "创建失败")
      setKeys(prev => [data, ...prev])
      setNewName("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败")
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    const token = getToken()
    if (!token) return
    setDeletingId(id)
    try {
      await fetch(`${apiBase}/api/keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      setKeys(prev => prev.filter(k => k.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  function copyKey(key: ApiKey) {
    navigator.clipboard.writeText(key.key)
    setCopiedId(key.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-white">设置</h1>
      <p className="mb-8 text-sm text-zinc-500">管理你的 API 密钥，用于本地脚本提交坦克。</p>

      {/* 创建新密钥 */}
      <Card className="mb-6 border-zinc-800 bg-zinc-900 ring-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-white">生成新 API 密钥</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-zinc-500">密钥生成后即可使用，请妥善保存——此后可随时在此页面查看完整密钥。</p>
          {error && <p className="rounded-md bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="密钥备注（如：本地开发）"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-blue-600 text-white hover:bg-blue-500"
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              生成
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 密钥列表 */}
      <Card className="border-zinc-800 bg-zinc-900 ring-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-white">我的 API 密钥</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-0 p-0">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-zinc-500" />
            </div>
          )}
          {!loading && keys.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">还没有 API 密钥</p>
          )}
          {keys.map((k, i) => (
            <div
              key={k.id}
              className={`flex items-center gap-3 px-4 py-3 ${i < keys.length - 1 ? "border-b border-zinc-800" : ""}`}
            >
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-white">{k.name}</span>
                <code className="truncate font-mono text-xs text-zinc-400">{k.key}</code>
                <span className="text-xs text-zinc-600">
                  {new Date(k.created_at).toLocaleDateString("zh-CN")}
                </span>
              </div>
              <button
                onClick={() => copyKey(k)}
                title="复制密钥"
                className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                {copiedId === k.id ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
              </button>
              <button
                onClick={() => handleDelete(k.id)}
                disabled={deletingId === k.id}
                title="删除密钥"
                className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-red-950 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                {deletingId === k.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card className="mt-6 border-zinc-800 bg-zinc-900 ring-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-white">如何使用 API 密钥</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-xs text-zinc-400">
          <p>将 API 密钥设置为 <code className="text-blue-400">X-API-Key</code> 请求头，即可从本地脚本提交坦克：</p>
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
{`curl -X POST http://localhost:3002/api/agent \\
  -H "X-API-Key: csk_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my_tank_v2",
    "code": "function act() { return { vx: 1, vy: 0, shoot: true }; }"
  }'`}
          </pre>
          <p>成功时返回 <code className="text-green-400">{`{"ok": true, "results": [...]}`}</code>，坦克自动上架排行榜。</p>
        </CardContent>
      </Card>
    </main>
  )
}
