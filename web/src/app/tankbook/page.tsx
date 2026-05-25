"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Send, ExternalLink, MessageSquare } from "lucide-react"
import Link from "next/link"
import { getCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// 卡片左边框颜色循环（荧光色）
const BORDER_COLORS = ["#FF3AF2", "#00F5D4", "#FFE600", "#FF6B35", "#7B2FFF"]

interface TankbookPost {
  id: string
  post_type: string
  author_name: string
  body: string
  match_id: string | null
  created_at: string
  battle_winner: string | null
  battle_total_ticks: number | null
  battle_opponent: string | null
}

// 相对时间格式化
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return "刚刚"
  if (mins < 60)  return `${mins} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  return `${days} 天前`
}

// 单条帖子卡片
function PostCard({ post, index }: { post: TankbookPost; index: number }) {
  const color = BORDER_COLORS[index % BORDER_COLORS.length]
  // 头像色相
  const hue   = [...post.author_name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5) }}
      className="relative overflow-hidden rounded-2xl p-5"
      style={{
        background:  "#12081F",
        border:      "3px solid rgba(255,255,255,0.06)",
        borderLeft:  `6px solid ${color}`,
        boxShadow:   `4px 4px 0 ${color}30`,
      }}
    >
      {/* 作者行 */}
      <div className="mb-3 flex items-center gap-3">
        {/* 头像 */}
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black text-white"
          style={{
            background:  `hsl(${hue}, 40%, 15%)`,
            borderColor: `hsl(${hue}, 70%, 60%)`,
          }}
        >
          {post.author_name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="block truncate text-sm font-black text-white">{post.author_name}</span>
          <span className="text-[11px] text-white/30">{relativeTime(post.created_at)}</span>
        </div>
        {/* 类型标签 */}
        <span
          className="shrink-0 rounded-full border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider"
          style={{ borderColor: color, color, background: `${color}15` }}
        >
          {post.post_type === "post" ? "动态" :
           post.post_type === "match_comment" ? "赛评" :
           post.post_type === "wall_post" ? "留言" : "回复"}
        </span>
      </div>

      {/* 正文 */}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/80">
        {post.body}
      </p>

      {/* 对战信息（若有 match_id）*/}
      {post.match_id && (
        <div
          className="mt-4 flex items-center justify-between rounded-xl px-4 py-2"
          style={{ background: `${color}12`, border: `2px solid ${color}40` }}
        >
          <div className="text-xs text-white/50">
            {post.battle_opponent && (
              <span>
                对战 <span className="font-bold text-white/70">{post.battle_opponent}</span>
                {post.battle_winner && (
                  <> · 胜者 <span style={{ color }} className="font-black">{post.battle_winner}</span></>
                )}
                {post.battle_total_ticks != null && (
                  <> · {post.battle_total_ticks} 回合</>
                )}
              </span>
            )}
          </div>
          <Link
            href={`/replay/${post.match_id}`}
            className="flex items-center gap-1 rounded-full border-2 px-3 py-1 text-[11px] font-black uppercase tracking-wide transition-all hover:scale-105"
            style={{ borderColor: color, color, background: `${color}20` }}
          >
            <ExternalLink className="size-3" />
            查看回放
          </Link>
        </div>
      )}
    </motion.article>
  )
}

export default function TankbookPage() {
  const [posts,   setPosts]   = useState<TankbookPost[]>([])
  const [page,    setPage]    = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore,  setHasMore]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [body,     setBody]     = useState("")
  const [posting,  setPosting]  = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const token    = useRef<string>("")
  const username = useRef<string>("")

  useEffect(() => {
    token.current    = getCookie("token") ?? ""
    username.current = getCookie("username") ?? ""
  }, [])

  // 加载帖子
  const loadPosts = async (pageNum: number, append = false) => {
    if (append) setLoadingMore(true)
    else        setLoading(true)
    setError(null)
    try {
      const r    = await fetch(`${apiBase}/api/tankbook?page=${pageNum}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as TankbookPost[]
      if (append) {
        setPosts(prev => [...prev, ...data])
      } else {
        setPosts(data)
      }
      // 少于 20 条说明没有更多
      if (data.length < 20) setHasMore(false)
    } catch {
      setError("加载失败，请刷新重试")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => { loadPosts(0) }, [])

  const handleLoadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    loadPosts(nextPage, true)
  }

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    if (!token.current) {
      setPostError("请先登录")
      return
    }
    setPosting(true)
    setPostError(null)
    try {
      const r = await fetch(`${apiBase}/api/tankbook`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token.current}`,
        },
        body: JSON.stringify({ body: body.trim() }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "发布失败" }))
        throw new Error(err.error ?? "发布失败")
      }
      setBody("")
      // 重新加载第一页
      setPage(0)
      setHasMore(true)
      await loadPosts(0)
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "发布失败")
    } finally {
      setPosting(false)
    }
  }

  const isLoggedIn = !!username.current

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0D0D1A] px-4 py-10">
      {/* 背景纹理 */}
      <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 pattern-stripes" />

      {/* 漂浮装饰 */}
      <div className="animate-max-float pointer-events-none absolute top-[8%] right-[4%] select-none text-5xl" aria-hidden="true">📣</div>
      <div className="animate-max-bounce pointer-events-none absolute top-[15%] left-[3%] select-none text-4xl" aria-hidden="true">💬</div>

      <div className="relative mx-auto w-full max-w-3xl flex flex-col gap-8">

        {/* 页面标题 */}
        <div>
          <p className="mb-2 font-mono text-xs font-black uppercase tracking-[0.4em] text-[#FF3AF2]">
            // tankbook
          </p>
          <h1
            className="text-5xl font-black uppercase tracking-tighter text-white md:text-6xl"
            style={{
              fontFamily: "var(--font-outfit)",
              textShadow: "2px 2px 0px #7B2FFF, 4px 4px 0px #FF3AF2",
            }}
          >
            动态流
          </h1>
          <p className="mt-2 text-sm font-medium text-white/40">
            查看所有玩家的最新动态、赛评与留言
          </p>
        </div>

        {/* ── 发帖表单 ── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="overflow-hidden rounded-3xl"
          style={{
            border:    "4px solid #7B2FFF",
            boxShadow: "6px 6px 0 #FF3AF2, 12px 12px 0 #FFE600",
          }}
        >
          <div
            className="px-6 py-4"
            style={{ background: "#1A0D2E", borderBottom: "4px solid #7B2FFF" }}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-[#7B2FFF]" />
              <span className="text-sm font-black uppercase tracking-widest text-[#7B2FFF]">
                {isLoggedIn ? `发帖 · @${username.current}` : "登录后即可发帖"}
              </span>
            </div>
          </div>

          <div className="bg-[#0D0D1A] p-6">
            {isLoggedIn ? (
              <form onSubmit={handlePost} className="flex flex-col gap-3">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="分享你的战斗心得、挑战评论……"
                  maxLength={2000}
                  rows={3}
                  className="w-full resize-none rounded-2xl border-4 border-[#7B2FFF]/40 bg-[#12081F] px-4 py-3 text-sm text-white placeholder:text-white/20 focus:border-[#7B2FFF] focus:outline-none transition-colors"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/20">{body.length} / 2000</span>
                  <button
                    type="submit"
                    disabled={posting || !body.trim()}
                    className="flex items-center gap-2 rounded-full border-4 border-[#7B2FFF] px-5 py-2 text-sm font-black uppercase tracking-wide text-white transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                      boxShadow:  posting ? "none" : "0 0 12px rgba(123,47,255,0.4), 2px 2px 0 #FFE600",
                    }}
                  >
                    {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    发布
                  </button>
                </div>
                {postError && (
                  <p className="text-xs font-bold text-[#FF6B35]">{postError}</p>
                )}
              </form>
            ) : (
              <p className="text-center text-sm text-white/30">
                <Link href="/login" className="text-[#FF3AF2] font-bold hover:underline">登录</Link>
                {" "}后即可发表动态
              </p>
            )}
          </div>
        </motion.div>

        {/* ── 错误提示 ── */}
        {error && (
          <div
            className="rounded-2xl px-4 py-3 text-sm font-bold text-[#FF6B35]"
            style={{ border: "4px dashed #FF6B35", background: "rgba(255,107,53,0.08)" }}
          >
            {error}
          </div>
        )}

        {/* ── 加载中 ── */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-16">
            <Loader2 className="size-5 animate-spin text-[#FF3AF2]" />
            <span className="text-sm font-black uppercase tracking-widest text-[#FF3AF2]">加载中…</span>
          </div>
        )}

        {/* ── 帖子列表 ── */}
        {!loading && (
          <div className="flex flex-col gap-4">
            <AnimatePresence mode="popLayout">
              {posts.map((post, i) => (
                <PostCard key={post.id} post={post} index={i} />
              ))}
            </AnimatePresence>

            {posts.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16">
                <span className="text-5xl animate-max-bounce" aria-hidden="true">🎯</span>
                <p className="text-sm font-black uppercase tracking-widest text-white/30">
                  暂无动态，快去发一条吧
                </p>
              </div>
            )}

            {/* Load More 按钮 */}
            {hasMore && posts.length > 0 && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-full border-4 border-dashed border-[#00F5D4] px-6 py-2 text-sm font-black uppercase tracking-widest text-[#00F5D4] transition-all hover:bg-[#00F5D4]/10 hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}

            {!hasMore && posts.length > 0 && (
              <p className="pt-2 text-center text-xs font-bold text-white/20 uppercase tracking-widest">
                — 已加载全部动态 —
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
