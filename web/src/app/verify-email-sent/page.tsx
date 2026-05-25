"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Mail } from "lucide-react"

function Content() {
  const email = useSearchParams().get("email") ?? "你的邮箱"
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-4 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
          <Mail className="size-8 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">请查收验证邮件</h1>
          <p className="mt-2 text-sm text-zinc-400">
            验证邮件已发送至 <span className="text-white">{email}</span>，
            点击邮件中的链接完成注册。
          </p>
        </div>
        <p className="text-xs text-zinc-600">
          没收到？请检查垃圾邮件文件夹，或{" "}
          <Link href="/register" className="text-blue-400 hover:underline">
            重新注册
          </Link>
        </p>
      </div>
    </main>
  )
}

export default function VerifyEmailSentPage() {
  return <Suspense><Content /></Suspense>
}
