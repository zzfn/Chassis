"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, Plus, Shield, Swords, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

const DEFAULT_CODE = `// 你的第一辆坦克 —— v0 入门版
// 引擎在命令队列为空时调用 onIdle(me, enemy, game)。
// 排队的命令会逐帧执行，每帧 1 条。
function onIdle(me, enemy, game) {
  // 场上没有存活敌人时，原地右转继续观察
  if (!enemy) {
    me.turn("right");
    return;
  }

  // 计算敌人相对自身的偏移（tile 坐标）
  var dx = enemy.tank.position[0] - me.tank.position[0];
  var dy = enemy.tank.position[1] - me.tank.position[1];

  // 选一个朝向：哪个轴上距离更远，就先对准那个轴
  var want;
  if (Math.abs(dx) >= Math.abs(dy)) {
    want = dx > 0 ? "east" : "west";
  } else {
    want = dy > 0 ? "south" : "north";
  }

  // 还没对准：右转 90°，最多 3 次就能转到任意朝向
  if (me.tank.direction !== want) {
    me.turn("right");
    return;
  }

  // 已对准敌人方向：冷却好就开火，然后推进 1 格
  if (me.tank.shootCooldown === 0) me.fire();
  me.go();
}`

interface TankSkin {
  svg?: string
  description?: string
}

interface Tank {
  agent_id: string
  agent_name: string
  created_at: string
  pvp_wins?: number
  pvp_losses?: number
  pvp_battles?: number
  elo?: number
  skin?: TankSkin
}

function TankAvatar({ name, skin }: { name: string; skin?: TankSkin }) {
  const initials = name.slice(0, 2).toUpperCase()
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-700 text-xl font-bold text-white"
      style={{ background: `hsl(${hue},40%,${skin?.svg ? 10 : 22}%)` }}
    >
      {skin?.svg ? (
        <svg
          viewBox="-20 -14 40 28"
          width="72"
          height="50"
          dangerouslySetInnerHTML={{ __html: skin.svg }}
        />
      ) : (
        initials
      )}
    </div>
  )
}

function getEloTier(elo: number, battles: number) {
  if (battles === 0) return { label: "新兵", color: "#71717a", border: "border-zinc-600" }
  if (elo >= 1800)   return { label: "钻石", color: "#818cf8", border: "border-indigo-500/60" }
  if (elo >= 1500)   return { label: "铂金", color: "#67e8f9", border: "border-cyan-700/60" }
  if (elo >= 1300)   return { label: "黄金", color: "#fbbf24", border: "border-yellow-700/60" }
  if (elo >= 1100)   return { label: "白银", color: "#a1a1aa", border: "border-zinc-500" }
  return { label: "青铜", color: "#c2874f", border: "border-orange-800/60" }
}

function TanksContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tanks, setTanks] = useState<Tank[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [skinDesc, setSkinDesc] = useState("")
  const [creating, setCreating] = useState(false)
  const [creatingStep, setCreatingStep] = useState<"" | "agent" | "skin">("")
  const [createError, setCreateError] = useState<string | null>(null)

  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
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
  }, [router])

  // 点击外部关闭菜单
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  function randomName() {
    const prefixes = ["Iron","Steel","Shadow","Storm","Blaze","Void","Nova","Apex","Titan","Ghost","Frost","Ember"]
    const suffixes = ["Strike","Runner","Guard","Hunter","Blade","Wolf","Hawk","Rex","Zero","Prime","Core","Viper"]
    const p = prefixes[Math.floor(Math.random() * prefixes.length)]
    const s = suffixes[Math.floor(Math.random() * suffixes.length)]
    setNewName(`${p}${s}`)
  }

  async function handleCreate() {
    const token = getCookie("token")
    if (!token) { router.push("/login"); return }
    if (!newName.trim()) { setCreateError("请输入坦克名称"); return }
    setCreating(true); setCreateError(null); setCreatingStep("agent")
    try {
      const res = await fetch(`${apiBase}/api/agent`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), code: DEFAULT_CODE }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "创建失败")

      // 有样式描述则生成皮肤（失败不阻塞创建，可在详情页重试）
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
      setCreating(false)
      setCreatingStep("")
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
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      {/* 顶部操作栏 */}
      <div className="mb-6">
        <button
          onClick={() => { setShowNew(v => !v); setCreateError(null); setNewName(""); setSkinDesc("") }}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          <Plus className="size-4" />
          新建坦克
        </button>
      </div>

      {/* 新建坦克模态框 */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={e => { if (e.target === e.currentTarget) { setShowNew(false); setCreateError(null) } }}
        >
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">

            {/* 头部 */}
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
              <div>
                <h2 className="text-lg font-bold text-white">创建坦克</h2>
                <p className="mt-1 text-sm text-zinc-400">给坦克取名，描述一下你想要的外观，让它带着专属皮肤入场。代码可以之后在详情页慢慢调。</p>
              </div>
              <button
                onClick={() => { setShowNew(false); setCreateError(null) }}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors"
              >
                关闭
              </button>
            </div>

            <div className="flex flex-col gap-5 p-5">
              {/* 坦克名称 */}
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-300">坦克名称</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setCreateError(null) }}
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                    placeholder="例如：IronStrike、NovaHawk…"
                    autoFocus
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={randomName}
                    title="随机生成名称"
                    className="rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors"
                  >
                    随机
                  </button>
                </div>
              </div>

              {/* 坦克样式 */}
              <div>
                <p className="mb-1 text-sm font-semibold text-zinc-300">坦克样式</p>
                <p className="mb-3 text-xs text-zinc-500">用一句话描述坦克外观，DeepSeek 将生成专属 SVG 皮肤。留空可跳过，之后在详情页随时生成。</p>
                <textarea
                  value={skinDesc}
                  onChange={e => setSkinDesc(e.target.value)}
                  placeholder="例如：一辆重型工业风坦克，厚装甲板和宽履带，深灰色涂装，带红色警戒线…"
                  rows={3}
                  disabled={creating}
                  className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              {createError && <p className="rounded-lg bg-red-950 px-3 py-2 text-xs text-red-400">{createError}</p>}
            </div>

            {/* 底部按钮 */}
            <div className="border-t border-zinc-800 px-5 py-4">
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {creatingStep === "skin" ? "生成皮肤中…" : "创建中…"}
                  </span>
                ) : "创建坦克"}
              </button>
            </div>

          </div>
        </div>
      )}

      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-400">{error}</p>}

      {loading && (
        <div className="flex items-center gap-2 py-12 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" /> 加载中...
        </div>
      )}

      {!loading && !error && tanks.length === 0 && (
        <p className="py-16 text-center text-sm text-zinc-500">
          还没有坦克，点击「新建坦克」开始
        </p>
      )}

      {/* 坦克卡片列表 */}
      <div className="flex flex-col gap-3" ref={menuRef}>
        {tanks.map(tank => {
          const elo     = Math.round(tank.elo ?? 1000)
          const wins    = tank.pvp_wins    ?? 0
          const losses  = tank.pvp_losses  ?? 0
          const battles = tank.pvp_battles ?? 0
          const tier    = getEloTier(elo, battles)
          const winRate = battles > 0 ? Math.round((wins / battles) * 100) : 0

          return (
            <div
              key={tank.agent_id}
              className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-700"
            >
              {/* 段位色条 */}
              <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: tier.color }} />

              {/* 右上角 ⋯ 菜单 */}
              <div className="absolute right-3 top-3 z-10">
                <button
                  onClick={() => setMenuOpen(menuOpen === tank.agent_id ? null : tank.agent_id)}
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {menuOpen === tank.agent_id && (
                  <div className="absolute right-0 top-9 min-w-[140px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                    <button
                      onClick={() => { router.push(`/tanks/${tank.agent_id}`); setMenuOpen(null) }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                    >
                      <Pencil className="size-3.5" /> 编辑代码
                    </button>
                    <button
                      onClick={() => { setDeleteTarget({ id: tank.agent_id, name: tank.agent_name }); setMenuOpen(null) }}
                      disabled={deletingId === tank.agent_id}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-zinc-800 disabled:opacity-40"
                    >
                      {deletingId === tank.agent_id ? (
                        <><Loader2 className="size-3.5 animate-spin" /> 删除中…</>
                      ) : (
                        <><Trash2 className="size-3.5" /> 删除</>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* 主信息区 */}
              <div className="flex gap-5 p-5 pl-6">
                <TankAvatar name={tank.agent_name} skin={tank.skin} />
                <div className="flex flex-1 flex-col justify-center gap-1.5 min-w-0 pr-10">
                  <h3 className="truncate text-xl font-bold text-white">{tank.agent_name}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border ${tier.border} px-2 py-0.5 text-xs font-semibold`}
                      style={{ color: tier.color }}
                    >
                      <Shield className="size-3" /> {tier.label}
                    </span>
                    <span className="text-zinc-600">·</span>
                    <span className="font-mono text-zinc-300">Elo {elo}</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {battles === 0
                      ? "暂无对战 · 去竞技场打第一场吧"
                      : `${wins} 胜 ${losses} 负 · 胜率 ${winRate}%`}
                  </p>
                </div>
              </div>

              {/* 底部操作区 */}
              <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/40 px-5 py-3">
                <button
                  onClick={() => router.push(`/tanks/${tank.agent_id}`)}
                  className="rounded-md border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  详情
                </button>
                <button
                  onClick={() => router.push(`/race?tank=${tank.agent_id}`)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
                >
                  <Swords className="size-4" /> 立即对战
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </main>

    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除坦克「{deleteTarget?.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            该坦克的全部历史版本、皮肤、Elo 与绑定密钥都会被清除（对战记录会保留）。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            className="bg-red-600 hover:bg-red-500 focus-visible:ring-red-600"
          >
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
