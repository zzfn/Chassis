"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import { setCookie } from "@/lib/cookie"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

function Content() {
  const router = useRouter()
  const token  = useSearchParams().get("token")
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [errMsg, setErrMsg] = useState("")

  useEffect(() => {
    if (!token) { setStatus("error"); setErrMsg("无效的验证链接"); return }
    fetch(`${apiBase}/api/verify-email?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.error ?? "验证失败")
        setCookie("token",    data.token)
        setCookie("username", data.username)
        setStatus("success")
        setTimeout(() => router.push("/tanks?new=1"), 1500)
      })
      .catch(e => {
        setErrMsg(e instanceof Error ? e.message : "验证失败")
        setStatus("error")
      })
  }, [token, router])

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-4 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="size-10 animate-spin text-blue-400" />
            <p className="text-sm text-zinc-400">正在验证邮箱…</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="size-10 text-emerald-400" />
            <p className="text-base font-bold text-white">邮箱验证成功</p>
            <p className="text-sm text-zinc-400">正在跳转…</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="size-10 text-red-400" />
            <p className="text-base font-bold text-white">验证失败</p>
            <p className="text-sm text-zinc-500">{errMsg}</p>
            <a href="/register" className="mt-2 text-sm text-blue-400 hover:underline">
              重新注册
            </a>
          </>
        )}
      </div>
    </main>
  )
}

export default function VerifyEmailPage() {
  return <Suspense><Content /></Suspense>
}
