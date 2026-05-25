"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { getCookie, deleteCookie } from "@/lib/cookie"

const navLinks = [
  { href: "/tanks",        label: "我的坦克" },
  { href: "/race",         label: "竞技场" },
  { href: "/tournament",   label: "锦标赛" },
  { href: "/dashboard",    label: "排行榜" },
  { href: "/agent-guide",  label: "Agent 文档" },
]

const menuItems = [
  { label: "成就",     href: "/tanks",      },
  { label: "设置",     href: "/settings",   },
  { label: "邀请奖励", href: "/tournament", },
]

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [username, setUsername] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setUsername(getCookie("username"))
  }, [pathname])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  function handleLogout() {
    deleteCookie("token")
    deleteCookie("username")
    setUsername(null)
    setOpen(false)
    router.push("/")
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">

        {/* 左：Logo + 导航 */}
        <div className="flex items-center gap-8">
          <Link href="/" className="text-lg font-bold tracking-tight text-white">
            DeepTank
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* 右：用户区 */}
        <div className="flex items-center gap-3">
          {username ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setOpen(v => !v)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
              >
                {username}
              </button>

              {open && (
                <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
                  <div className="flex flex-col py-1">
                    {menuItems.map(item => (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="px-5 py-3.5 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        {item.label}
                      </Link>
                    ))}
                    <div className="mx-3 my-1 border-t border-zinc-800" />
                    <button
                      onClick={handleLogout}
                      className="mx-2 mb-2 rounded-lg bg-red-950/50 px-3 py-3 text-left text-sm font-medium text-red-400 hover:bg-red-950 transition-colors"
                    >
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-zinc-700 bg-transparent px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              登录
            </Link>
          )}
        </div>

      </div>
    </nav>
  )
}
