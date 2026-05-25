"use client"
import { useState } from "react"

export function CopyButton() {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const el = document.getElementById("starter-prompt")
    if (!el) return
    navigator.clipboard.writeText(el.textContent ?? "").then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded px-2.5 py-1 text-xs font-medium transition-colors
        text-zinc-400 hover:text-white hover:bg-zinc-700"
    >
      {copied ? "已复制 ✓" : "复制"}
    </button>
  )
}
