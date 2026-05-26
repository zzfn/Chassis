"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Trash2, Zap } from "lucide-react"
import { getCookie } from "@/lib/cookie"
import { getEloTier } from "@/lib/elo"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

// ── 通用类型 ──────────────────────────────────────────────────

interface UserAgentEntry {
  agent_id: string
  agent_name: string
  created_at: string
  pvp_battles: number
  pvp_wins: number
  pvp_losses: number
  version: number
  elo: number
}

interface MatchRecord {
  id: string
  challenger: string
  opponent: string
  winner: string
  total_ticks: number
  created_at: string
}

interface PlayerEntry {
  agent_id: string
  agent_name: string
  owner: string
  pvp_battles: number
  pvp_wins: number
  version: number
}

interface GameContext {
  agents: UserAgentEntry[]
  current_name: string | null
  code: string | null
  version: number
}

// ── 游戏配置接口 ──────────────────────────────────────────────

export interface GameArenaConfig {
  /** API 路径前缀，如 'snake'、'bomberman'，对应 /api/{apiPath}/... */
  apiPath: string
  /** 回放页面路径前缀，如 '/snake/replay' */
  replayPath: string
  /** Agent 的称谓，如 '蛇'、'炸弹人' */
  agentLabel: string
  /** 页面大标题，如 '我的蛇' */
  pageTitle: string
  /** 页面 sys 标识，如 'SNAKE_MGMT.SYS' */
  sysLabel: string
  /** 三个 Tab（编辑/历史/挑战）的强调色 */
  tabAccents: [string, string, string]
  /** 编辑器默认代码模板 */
  defaultCode: string
  /**
   * challenge API 请求体中 agent 名字段名。
   * snake 后端用 `snake_name`；未来新游戏可以统一为 `agent_name`。
   */
  challengeAgentField: string
}

// ── 辅助函数 ──────────────────────────────────────────────────

function makeHeaders(): HeadersInit {
  const token = getCookie("token")
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// ── 三点 Chrome 装饰 ──────────────────────────────────────────

function ChromeDots() {
  return (
    <span className="flex gap-1.5">
      {(["#00F5D4", "#FFE600", "#7B2FFF"] as const).map(c => (
        <span key={c} className="block size-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
      ))}
    </span>
  )
}

// ── 错误条 ────────────────────────────────────────────────────

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{ border: "2px dashed #FF6B35", background: "rgba(255,107,53,0.07)" }}
    >
      <span className="font-mono text-xs font-black" style={{ color: "#FF6B35" }}>[ERR]</span>
      <span className="font-mono text-xs text-white/55">{msg}</span>
    </div>
  )
}

// ── Tab 枚举 ──────────────────────────────────────────────────

type TabId = "editor" | "history" | "challenge"

const TABS: { id: TabId; label: string }[] = [
  { id: "editor",    label: "代码编辑" },
  { id: "history",   label: "对战历史" },
  { id: "challenge", label: "玩家挑战" },
]

// ── 主组件 ────────────────────────────────────────────────────

export function GameArenaPage({ config }: { config: GameArenaConfig }) {
  const router = useRouter()
  const { apiPath, replayPath, agentLabel, pageTitle, sysLabel, tabAccents, defaultCode, challengeAgentField } = config

  // ── 全局状态 ─────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>("editor")
  const [isLoggedIn] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null
    return !!getCookie("token")
  })
  const [ctx, setCtx] = useState<GameContext | null>(null)
  const [ctxLoading, setCtxLoading] = useState(false)

  // ── Tab1：代码编辑 ────────────────────────────────────────
  const [selectedName, setSelectedName] = useState("")
  const [customName, setCustomName] = useState("")
  const [code, setCode] = useState(defaultCode)
  const [codeDirty, setCodeDirty] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [simulateLoading, setSimulateLoading] = useState(false)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)

  // ── Tab2：对战历史 ────────────────────────────────────────
  const [historyName, setHistoryName] = useState("")
  const [matches, setMatches] = useState<MatchRecord[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [matchesError, setMatchesError] = useState<string | null>(null)

  // ── Tab3：玩家挑战 ────────────────────────────────────────
  const [players, setPlayers] = useState<PlayerEntry[]>([])
  const [playersLoading, setPlayersLoading] = useState(false)
  const [playersError, setPlayersError] = useState<string | null>(null)
  const [myAgentForChallenge, setMyAgentForChallenge] = useState("")
  const [challengingId, setChallengingId] = useState<string | null>(null)

  // ── 删除 agent ───────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  // ── 数据加载函数 ──────────────────────────────────────────

  async function loadContext(nameHint?: string) {
    const token = getCookie("token")
    if (!token) return
    setCtxLoading(true)
    try {
      const url = nameHint
        ? `${apiBase}/api/${apiPath}/context?name=${encodeURIComponent(nameHint)}`
        : `${apiBase}/api/${apiPath}/context`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // 后端 snake 返回 { snakes: [...] }，未来可以统一为 { agents: [...] }；
      // 这里做兼容处理，优先取 agents，fallback 到 snakes。
      const raw = await res.json() as Record<string, unknown>
      const agents = (raw.agents ?? raw.snakes ?? []) as UserAgentEntry[]
      const data: GameContext = {
        agents,
        current_name: raw.current_name as string | null,
        code: raw.code as string | null,
        version: raw.version as number,
      }
      setCtx(data)
      if (!nameHint) {
        if (data.current_name) {
          setSelectedName(data.current_name)
          if (data.code) setCode(data.code)
        } else if (agents.length > 0) {
          setSelectedName(agents[0].agent_name)
        }
        const firstName = data.current_name ?? agents[0]?.agent_name ?? ""
        setHistoryName(firstName)
        setMyAgentForChallenge(firstName)
      }
    } catch {
      // 静默失败
    } finally {
      setCtxLoading(false)
    }
  }

  async function loadCodeForAgent(name: string) {
    const token = getCookie("token")
    if (!token || !name) return
    try {
      const res = await fetch(
        `${apiBase}/api/${apiPath}/context?name=${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const raw = await res.json() as Record<string, unknown>
      if (raw.code) {
        setCode(raw.code as string)
        setCodeDirty(false)
      }
    } catch {}
  }

  async function loadMatches(name: string) {
    setMatchesLoading(true)
    setMatchesError(null)
    try {
      const res = await fetch(
        `${apiBase}/api/${apiPath}/matches?name=${encodeURIComponent(name)}&limit=50&offset=0`,
        { headers: makeHeaders() }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMatches(await res.json() as MatchRecord[])
    } catch (e) {
      setMatchesError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setMatchesLoading(false)
    }
  }

  async function loadPlayers() {
    setPlayersLoading(true)
    setPlayersError(null)
    try {
      const res = await fetch(`${apiBase}/api/${apiPath}/players`, { headers: makeHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setPlayers(await res.json() as PlayerEntry[])
    } catch (e) {
      setPlayersError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setPlayersLoading(false)
    }
  }

  // ── Effects ───────────────────────────────────────────────

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isLoggedIn) loadContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const token = getCookie("token")
    if (!token) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "history" && historyName) void loadMatches(historyName)
    if (tab === "challenge") void loadPlayers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  useEffect(() => {
    const token = getCookie("token")
    if (!token || tab !== "history" || !historyName) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMatches(historyName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyName])

  useEffect(() => {
    const token = getCookie("token")
    if (!token || !selectedName) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCodeForAgent(selectedName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName])

  // ── 操作函数 ──────────────────────────────────────────────

  function getActiveName() {
    return customName.trim() || selectedName || `my_${apiPath}`
  }

  async function submitCode(): Promise<boolean> {
    const name = getActiveName()
    setSubmitLoading(true)
    setEditorError(null)
    try {
      const res = await fetch(`${apiBase}/api/${apiPath}/code`, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify({ name, code }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setEditorError(data.error ?? "提交失败"); return false }
      setCodeDirty(false)
      await loadContext()
      return true
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "网络错误")
      return false
    } finally {
      setSubmitLoading(false)
    }
  }

  async function handleRandomBattle() {
    const name = getActiveName()
    setSimulateLoading(true)
    setEditorError(null)
    try {
      if (codeDirty) {
        const ok = await submitCode()
        if (!ok) { setSimulateLoading(false); return }
      }
      const res = await fetch(`${apiBase}/api/${apiPath}/simulate`, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify({ name, random_opponent: true }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok) { setEditorError(data.error ?? "对战失败"); return }
      if (data.id) router.push(`${replayPath}/${data.id}`)
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "网络错误")
    } finally {
      setSimulateLoading(false)
    }
  }

  async function handleMirrorBattle() {
    const name = getActiveName()
    setMirrorLoading(true)
    setEditorError(null)
    try {
      const res = await fetch(`${apiBase}/api/${apiPath}/simulate`, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify({ name }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok) { setEditorError(data.error ?? "对战失败"); return }
      if (data.id) router.push(`${replayPath}/${data.id}`)
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "网络错误")
    } finally {
      setMirrorLoading(false)
    }
  }

  async function handleDeleteAgent(name: string) {
    const token = getCookie("token")
    if (!token) return
    setDeletingName(name)
    try {
      const res = await fetch(`${apiBase}/api/${apiPath}/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? "删除失败")
      }
      await loadContext()
      if (selectedName === name) setSelectedName("")
      if (historyName === name) setHistoryName("")
      if (myAgentForChallenge === name) setMyAgentForChallenge("")
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeletingName(null)
      setDeleteTarget(null)
    }
  }

  async function handleChallenge(opponentId: string) {
    if (!myAgentForChallenge) return
    setChallengingId(opponentId)
    try {
      const res = await fetch(`${apiBase}/api/${apiPath}/challenge`, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify({ [challengeAgentField]: myAgentForChallenge, opponent_id: opponentId }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok) { alert(data.error ?? "挑战失败"); return }
      if (data.id) router.push(`${replayPath}/${data.id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : "网络错误")
    } finally {
      setChallengingId(null)
    }
  }

  // ── 未登录 / 加载中 ───────────────────────────────────────

  if (isLoggedIn === null) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[#0D0D1A] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#00F5D4]" />
      </main>
    )
  }

  if (!isLoggedIn) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[#0D0D1A] flex items-center justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[500px] opacity-[0.07]"
          style={{ background: "radial-gradient(circle, #00F5D4 0%, #7B2FFF 45%, transparent 70%)", filter: "blur(60px)" }}
        />
        <div className="relative text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.5em] mb-6" style={{ color: "#00F5D4" }}>
            &gt; AUTH_REQUIRED.SYS
          </p>
          <h2
            className="text-4xl font-black uppercase text-white mb-8"
            style={{ fontFamily: "var(--font-outfit)", textShadow: "3px 3px 0 #7B2FFF, 6px 6px 0 #00F5D4" }}
          >
            请先登录
          </h2>
          <a
            href="/login"
            className="-skew-x-3 inline-block font-mono font-black uppercase text-sm"
            style={{
              padding: "14px 40px",
              border: "2px solid #00F5D4",
              background: "linear-gradient(135deg, #00F5D4, #7B2FFF)",
              color: "#000",
              letterSpacing: "0.35em",
              boxShadow: "0 0 24px rgba(0,245,212,0.4)",
            }}
          >
            <span className="inline-block skew-x-3">LOGIN.EXE</span>
          </a>
        </div>
      </main>
    )
  }

  const agentOptions = ctx?.agents ?? []
  const [editorAccent, historyAccent, challengeAccent] = tabAccents

  return (
    <>
      <main className="relative min-h-screen overflow-hidden bg-[#0D0D1A] text-white">
        <div className="pointer-events-none absolute inset-0 pattern-dots opacity-[0.05]" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 size-[600px] opacity-[0.06]"
          style={{ background: `radial-gradient(circle, ${editorAccent} 0%, #7B2FFF 45%, transparent 70%)`, filter: "blur(60px)" }}
        />

        <div className="relative z-10 max-w-5xl mx-auto px-4 py-10">

          {/* ── 标题区 ── */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-8"
          >
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.5em] mb-2" style={{ color: editorAccent }}>
              &gt; {sysLabel}
            </p>
            <h1
              className="text-5xl font-black uppercase tracking-tighter text-white"
              style={{ fontFamily: "var(--font-outfit)", textShadow: `3px 3px 0 #7B2FFF, 6px 6px 0 ${editorAccent}` }}
            >
              {pageTitle}
            </h1>
          </motion.div>

          {/* ── Tab 导航 ── */}
          <motion.div
            className="flex gap-2 mb-8 flex-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {TABS.map((t, i) => {
              const active = tab === t.id
              const accent = tabAccents[i]
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="-skew-x-3 px-5 py-2 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200"
                  style={{
                    border: `2px ${active ? "solid" : "dashed"} ${active ? accent : "rgba(255,255,255,0.15)"}`,
                    background: active ? `${accent}18` : "transparent",
                    color: active ? accent : "rgba(255,255,255,0.4)",
                    boxShadow: active ? `0 0 14px ${accent}35` : "none",
                  }}
                >
                  <span className="inline-block skew-x-3">{t.label}</span>
                </button>
              )
            })}
          </motion.div>

          {/* ── Tab 1：代码编辑 ── */}
          {tab === "editor" && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="flex flex-col gap-5"
            >
              {/* Agent 名选择行 */}
              <div
                className="overflow-hidden"
                style={{
                  border: `2px solid ${editorAccent}59`,
                  borderTop: `2px solid ${editorAccent}`,
                  background: "rgba(0,0,0,0.6)",
                  boxShadow: `0 0 20px ${editorAccent}1a`,
                }}
              >
                <div
                  className="flex items-center gap-3 px-4 py-2 border-b-2"
                  style={{ background: `${editorAccent}0f`, borderColor: editorAccent }}
                >
                  <ChromeDots />
                  <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: editorAccent }}>
                    {apiPath.toUpperCase()}_CONFIG.SYS
                  </span>
                  {ctxLoading && <Loader2 className="size-3 animate-spin ml-auto" style={{ color: editorAccent }} />}
                </div>
                <div className="px-5 py-4 flex items-center gap-3 flex-wrap">
                  {agentOptions.length > 0 && (
                    <select
                      value={selectedName}
                      onChange={e => { setSelectedName(e.target.value); setCustomName("") }}
                      className="font-mono text-xs bg-black/60 focus:outline-none min-w-[140px] px-3 py-2"
                      style={{ border: `2px solid ${editorAccent}66`, color: editorAccent }}
                    >
                      {agentOptions.map(s => (
                        <option key={s.agent_id} value={s.agent_name} style={{ background: "#0D0D1A" }}>
                          {s.agent_name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    placeholder={`或输入新${agentLabel}名`}
                    className="font-mono text-xs bg-black/60 focus:outline-none w-40 px-3 py-2 text-white placeholder:text-white/25"
                    style={{ border: "2px dashed rgba(255,255,255,0.2)" }}
                  />
                  {!customName && selectedName && (() => {
                    const entry = agentOptions.find(s => s.agent_name === selectedName)
                    if (!entry) return null
                    const tier = getEloTier(Math.round(entry.elo ?? 1500), entry.pvp_battles)
                    return (
                      <>
                        <span className="font-mono text-[10px] px-2 py-1" style={{ color: "#7B2FFF", border: "1px solid rgba(123,47,255,0.4)" }}>
                          v{entry.version}
                        </span>
                        <span
                          className="font-mono text-[10px] px-2 py-1"
                          style={{ color: tier.color, border: `1px solid ${tier.color}50`, background: `${tier.color}10` }}
                        >
                          {tier.label} {Math.round(entry.elo ?? 1500)}
                        </span>
                        <button
                          onClick={() => setDeleteTarget(selectedName)}
                          className="p-1.5 transition-opacity hover:opacity-100 opacity-50"
                          style={{ color: "#FF6B35" }}
                          title={`删除${agentLabel}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )
                  })()}
                </div>
              </div>

              {editorError && <ErrorBar msg={editorError} />}

              {/* 代码编辑区 */}
              <div
                className="overflow-hidden"
                style={{
                  border: `2px solid ${editorAccent}59`,
                  borderTop: `2px solid ${editorAccent}`,
                  background: "rgba(0,0,0,0.6)",
                  boxShadow: `0 0 20px ${editorAccent}1a`,
                }}
              >
                <div
                  className="flex items-center gap-3 px-4 py-2 border-b-2"
                  style={{ background: `${editorAccent}0f`, borderColor: editorAccent }}
                >
                  <ChromeDots />
                  <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: editorAccent }}>
                    CODE_EDITOR.EXE
                  </span>
                </div>
                <MonacoEditor
                  height="420px"
                  language="javascript"
                  theme="vs-dark"
                  value={code}
                  onChange={v => { setCode(v ?? ""); setCodeDirty(true) }}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: "on",
                    wordWrap: "on",
                    padding: { top: 12 },
                  }}
                />
              </div>

              {/* 按钮行 */}
              <div className="flex items-center gap-3 flex-wrap">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { submitCode() }}
                  disabled={submitLoading || simulateLoading || mirrorLoading}
                  className="-skew-x-3 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 disabled:opacity-30"
                  style={{
                    padding: "10px 24px",
                    border: `2px solid ${editorAccent}`,
                    background: submitLoading ? `${editorAccent}1a` : `linear-gradient(135deg, ${editorAccent}, ${editorAccent}cc)`,
                    color: submitLoading ? editorAccent : "#000",
                    boxShadow: submitLoading ? "none" : `0 0 16px ${editorAccent}59`,
                  }}
                >
                  <span className="inline-flex items-center gap-2 skew-x-3">
                    {submitLoading && <Loader2 className="size-3 animate-spin" />}
                    {submitLoading ? "提交中..." : "提交代码"}
                  </span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleRandomBattle}
                  disabled={submitLoading || simulateLoading || mirrorLoading}
                  className="-skew-x-3 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 disabled:opacity-30"
                  style={{
                    padding: "10px 24px",
                    border: "2px solid #7B2FFF",
                    background: simulateLoading ? "rgba(123,47,255,0.12)" : "transparent",
                    color: "#7B2FFF",
                    boxShadow: simulateLoading ? "none" : "0 0 12px rgba(123,47,255,0.2)",
                  }}
                >
                  <span className="inline-flex items-center gap-2 skew-x-3">
                    {simulateLoading ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                    {simulateLoading ? "运行中..." : "随机对战"}
                  </span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleMirrorBattle}
                  disabled={submitLoading || simulateLoading || mirrorLoading}
                  className="-skew-x-3 font-mono text-xs font-black uppercase tracking-widest transition-all duration-200 disabled:opacity-30"
                  style={{
                    padding: "10px 24px",
                    border: "2px dashed rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: mirrorLoading ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.4)",
                  }}
                >
                  <span className="inline-flex items-center gap-2 skew-x-3">
                    {mirrorLoading && <Loader2 className="size-3 animate-spin" />}
                    {mirrorLoading ? "测试中..." : "镜像测试"}
                  </span>
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── Tab 2：对战历史 ── */}
          {tab === "history" && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="flex flex-col gap-5"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">AGENT:</span>
                {agentOptions.length > 0 ? (
                  <select
                    value={historyName}
                    onChange={e => setHistoryName(e.target.value)}
                    className="font-mono text-xs bg-black/60 focus:outline-none min-w-[140px] px-3 py-2"
                    style={{ border: `2px solid ${historyAccent}66`, color: historyAccent }}
                  >
                    {agentOptions.map(s => (
                      <option key={s.agent_id} value={s.agent_name} style={{ background: "#0D0D1A" }}>
                        {s.agent_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-xs text-white/30">暂无 {agentLabel}，先去提交代码</span>
                )}
              </div>

              {matchesError && <ErrorBar msg={matchesError} />}

              <div
                className="overflow-hidden"
                style={{
                  border: `2px solid ${historyAccent}59`,
                  borderTop: `2px solid ${historyAccent}`,
                  background: "rgba(0,0,0,0.6)",
                  boxShadow: `0 0 20px ${historyAccent}14`,
                }}
              >
                <div
                  className="flex items-center gap-3 px-4 py-2 border-b-2"
                  style={{ background: `${historyAccent}0f`, borderColor: historyAccent }}
                >
                  <ChromeDots />
                  <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: historyAccent }}>
                    BATTLE_HISTORY.LOG
                  </span>
                  {matchesLoading && <Loader2 className="size-3 animate-spin ml-auto" style={{ color: historyAccent }} />}
                </div>

                {matchesLoading ? (
                  <div className="flex items-center justify-center gap-3 py-16">
                    <Loader2 className="size-4 animate-spin" style={{ color: historyAccent }} />
                    <span className="font-mono text-xs uppercase tracking-widest text-white/40">LOADING...</span>
                  </div>
                ) : matches.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="font-mono text-xs uppercase tracking-widest text-white/25">NO_RECORDS_FOUND</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${historyAccent}26` }}>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">对手</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">结果</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">回合数</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">时间</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m, i) => {
                        const isWin = m.winner === historyName
                        const opponent = m.challenger === historyName ? m.opponent : m.challenger
                        return (
                          <tr
                            key={m.id}
                            className="transition-colors duration-100"
                            style={{ borderBottom: i < matches.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)" }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                          >
                            <td className="px-5 py-3 font-mono text-xs text-white/70">{opponent}</td>
                            <td className="px-5 py-3">
                              <span
                                className="-skew-x-3 inline-block font-mono text-[10px] font-black px-2.5 py-0.5"
                                style={{
                                  color: isWin ? "#00F5D4" : "#FF6B35",
                                  border: `1px solid ${isWin ? "rgba(0,245,212,0.4)" : "rgba(255,107,53,0.4)"}`,
                                  background: isWin ? "rgba(0,245,212,0.08)" : "rgba(255,107,53,0.08)",
                                }}
                              >
                                <span className="inline-block skew-x-3">{isWin ? "WIN" : "LOSS"}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-white/40">{m.total_ticks}</td>
                            <td className="px-5 py-3 font-mono text-[10px] text-white/30">
                              {new Date(m.created_at).toLocaleString()}
                            </td>
                            <td className="px-5 py-3">
                              <button
                                onClick={() => router.push(`${replayPath}/${m.id}`)}
                                className="-skew-x-3 font-mono text-[10px] font-black uppercase tracking-widest transition-all duration-200"
                                style={{ padding: "4px 12px", border: "1px solid rgba(123,47,255,0.5)", color: "#7B2FFF" }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(123,47,255,0.12)" }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                              >
                                <span className="inline-block skew-x-3">→ REPLAY</span>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Tab 3：玩家挑战 ── */}
          {tab === "challenge" && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="flex flex-col gap-5"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">MY_AGENT:</span>
                {agentOptions.length > 0 ? (
                  <select
                    value={myAgentForChallenge}
                    onChange={e => setMyAgentForChallenge(e.target.value)}
                    className="font-mono text-xs bg-black/60 focus:outline-none min-w-[140px] px-3 py-2"
                    style={{ border: `2px solid ${challengeAccent}66`, color: challengeAccent }}
                  >
                    {agentOptions.map(s => (
                      <option key={s.agent_id} value={s.agent_name} style={{ background: "#0D0D1A" }}>
                        {s.agent_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-white/30">还没有{agentLabel}，先在编辑器提交代码</span>
                    <button
                      onClick={() => setTab("editor")}
                      className="-skew-x-3 font-mono text-[10px] font-black uppercase tracking-widest"
                      style={{
                        padding: "6px 16px",
                        border: `2px solid ${editorAccent}`,
                        background: `linear-gradient(135deg, ${editorAccent}, ${editorAccent}cc)`,
                        color: "#000",
                      }}
                    >
                      <span className="inline-block skew-x-3">去编辑</span>
                    </button>
                  </div>
                )}
              </div>

              {playersError && <ErrorBar msg={playersError} />}

              <div
                className="overflow-hidden"
                style={{
                  border: `2px solid ${challengeAccent}59`,
                  borderTop: `2px solid ${challengeAccent}`,
                  background: "rgba(0,0,0,0.6)",
                  boxShadow: `0 0 20px ${challengeAccent}14`,
                }}
              >
                <div
                  className="flex items-center gap-3 px-4 py-2 border-b-2"
                  style={{ background: `${challengeAccent}0f`, borderColor: challengeAccent }}
                >
                  <ChromeDots />
                  <span className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: challengeAccent }}>
                    PLAYER_LIST.EXE
                  </span>
                  {playersLoading && <Loader2 className="size-3 animate-spin ml-auto" style={{ color: challengeAccent }} />}
                </div>

                {playersLoading ? (
                  <div className="flex items-center justify-center gap-3 py-16">
                    <Loader2 className="size-4 animate-spin" style={{ color: challengeAccent }} />
                    <span className="font-mono text-xs uppercase tracking-widest text-white/40">SCANNING_PLAYERS...</span>
                  </div>
                ) : players.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="font-mono text-xs uppercase tracking-widest text-white/25">NO_PLAYERS_FOUND</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${challengeAccent}26` }}>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">{agentLabel}名</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">持有者</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">胜场</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">战数</th>
                        <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">版本</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {players.map((p, i) => (
                        <tr
                          key={p.agent_id}
                          className="transition-colors duration-100"
                          style={{ borderBottom: i < players.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)" }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                        >
                          <td className="px-5 py-3 font-mono text-xs font-black" style={{ color: editorAccent }}>{p.agent_name}</td>
                          <td className="px-5 py-3 font-mono text-xs text-white/50">{p.owner}</td>
                          <td className="px-5 py-3 font-mono text-xs font-black" style={{ color: "#FFE600" }}>{p.pvp_wins}</td>
                          <td className="px-5 py-3 font-mono text-xs text-white/40">{p.pvp_battles}</td>
                          <td className="px-5 py-3 font-mono text-[10px] text-white/30">v{p.version}</td>
                          <td className="px-5 py-3">
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleChallenge(p.agent_id)}
                              disabled={!myAgentForChallenge || challengingId === p.agent_id}
                              className="-skew-x-3 font-mono text-[10px] font-black uppercase tracking-widest transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                              style={{
                                padding: "5px 14px",
                                border: `2px solid ${challengeAccent}`,
                                background: challengingId === p.agent_id ? `${challengeAccent}26` : "transparent",
                                color: challengeAccent,
                                boxShadow: challengingId === p.agent_id ? "none" : `0 0 8px ${challengeAccent}33`,
                              }}
                            >
                              <span className="inline-flex items-center gap-1.5 skew-x-3">
                                {challengingId === p.agent_id && <Loader2 className="size-3 animate-spin" />}
                                {challengingId === p.agent_id ? "挑战中..." : "挑战"}
                              </span>
                            </motion.button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </motion.div>
          )}

        </div>
      </main>

      {/* ── 删除确认弹窗 ── */}
      <AnimatePresence>
        {deleteTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D1A]/85 px-4 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              exit={{   opacity: 0, scale: 0.92, y: 16  }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md overflow-hidden"
              style={{
                background: "rgba(13,13,26,0.95)",
                border:     "2px solid #FF6B35",
                boxShadow:  "4px 4px 0 #FF3AF2, 0 0 24px rgba(255,107,53,0.2)",
              }}
            >
              <div className="px-6 py-5" style={{ borderBottom: "2px dashed #FF6B35" }}>
                <h2
                  className="text-xl font-black uppercase tracking-tight text-white"
                  style={{ fontFamily: "var(--font-outfit)", textShadow: "2px 2px 0 #FF6B35" }}
                >
                  删除{agentLabel}？
                </h2>
                <p className="mt-1 text-sm font-bold" style={{ color: "#FF6B35" }}>「{deleteTarget}」</p>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-white/55">
                  此操作将删除该{agentLabel}的全部代码记录和 ELO 数据，对战记录保留。不可撤销。
                </p>
                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="flex-1 font-mono text-xs font-black uppercase tracking-widest py-3 transition-all"
                    style={{ border: "2px dashed #00F5D4", color: "#00F5D4" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,245,212,0.08)" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => deleteTarget && handleDeleteAgent(deleteTarget)}
                    disabled={!!deletingName}
                    className="flex-1 font-mono text-xs font-black uppercase tracking-widest py-3 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    style={{
                      background: "linear-gradient(135deg, #FF6B35, #FF3AF2)",
                      border:     "2px solid #FF6B35",
                    }}
                  >
                    {deletingName ? "删除中..." : "确认删除"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
