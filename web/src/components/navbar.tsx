"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { getCookie, deleteCookie } from "@/lib/cookie"
import { Swords } from "lucide-react"

const NAV_ACCENTS = ["#FF3AF2", "#00F5D4", "#FFE600", "#FF6B35", "#7B2FFF"]

const TANK_NAV = [
  { href: "/race",        label: "竞技场" },
  { href: "/matches",     label: "公开对战" },
  { href: "/tournament",  label: "锦标赛" },
  { href: "/dashboard",   label: "排行榜" },
  { href: "/models",      label: "模型榜" },
  { href: "/tanks",       label: "我的坦克" },
  { href: "/shop",        label: "商店" },
  { href: "/agent-guide", label: "Agent 文档" },
  { href: "/about",       label: "关于" },
]

const SNAKE_NAV = [
  { href: "/snake/arena",       label: "竞技场"    },
  { href: "/snake/tournament",  label: "锦标赛"    },
  { href: "/snake/leaderboard", label: "排行榜"    },
  { href: "/snake",             label: "我的蛇"    },
  { href: "/shop",              label: "商店"      },
  { href: "/snake/agent-guide", label: "Agent 文档" },
]

const BOMBER_NAV = [
  { href: "/bomberman", label: "竞技场" },
]

const MENU_ITEMS = [
  { label: "成就", href: "/achievements" },
  { label: "设置", href: "/settings" },
]

export function Navbar() {
  const pathname = usePathname()
  const router   = useRouter()
  const [username, setUsername] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const snakeMode  = pathname === "/snake" || pathname.startsWith("/snake/")
  const bomberMode = pathname === "/bomberman" || pathname.startsWith("/bomberman/")
  const navLinks    = bomberMode ? BOMBER_NAV : (snakeMode ? SNAKE_NAV : TANK_NAV)
  const borderColor = bomberMode ? "#FF6B35" : (snakeMode ? "#00F5D4" : "#FF3AF2")
  const shadowColor = bomberMode ? "rgba(255,107,53,0.35)" : (snakeMode ? "rgba(0,245,212,0.35)" : "rgba(255,58,242,0.35)")

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setUsername(getCookie("username")) }, [pathname])

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
    deleteCookie("user_id")
    setUsername(null)
    setOpen(false)
    router.push("/")
  }

  return (
    <nav
      className="sticky top-0 z-50 backdrop-blur-md"
      style={{
        background:   "rgba(13,13,26,0.92)",
        borderBottom: `4px solid ${borderColor}`,
        boxShadow:    `0 4px 24px ${shadowColor}`,
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">

        {/* Logo + nav */}
        <div className="flex items-center gap-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Swords
              className="size-5 animate-max-wiggle"
              style={{ color: "#FF3AF2" }}
              aria-hidden="true"
            />
            <span
              className="text-gradient-max text-xl font-black uppercase tracking-tight"
              style={{ fontFamily: "var(--font-outfit)" }}
            >
              DeepTank
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link, i) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href))
              const accent = NAV_ACCENTS[i % NAV_ACCENTS.length]
              return (
                <NavLink key={link.href} href={link.href} active={active} accent={accent}>
                  {link.label}
                </NavLink>
              )
            })}
          </div>
        </div>

        {/* User area */}
        <div className="flex items-center gap-3">
          {username ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setOpen(v => !v)}
                className="rounded-full border-4 border-[#FFE600] px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-105 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
                  boxShadow:  "0 0 15px rgba(255,58,242,0.5), 3px 3px 0 #FFE600",
                }}
              >
                {username}
              </button>

              {open && (
                <div
                  className="absolute right-0 top-12 z-50 w-52 overflow-hidden rounded-2xl py-1"
                  style={{
                    background: "#1A0D2E",
                    border:     "4px solid #7B2FFF",
                    boxShadow:  "8px 8px 0 #FF3AF2, 0 0 20px rgba(123,47,255,0.4)",
                  }}
                >
                  {MENU_ITEMS.map((item, i) => (
                    <DropdownItem key={item.label} href={item.href} accent={NAV_ACCENTS[i]} onClick={() => setOpen(false)}>
                      {item.label}
                    </DropdownItem>
                  ))}
                  {bomberMode ? (
                    <DropdownItem href="/" accent="#FF3AF2" onClick={() => setOpen(false)}>
                      🗡️ 切换到坦克
                    </DropdownItem>
                  ) : snakeMode ? (
                    <>
                      <DropdownItem href="/" accent="#FF3AF2" onClick={() => setOpen(false)}>
                        🗡️ 切换到坦克
                      </DropdownItem>
                      <DropdownItem href="/bomberman" accent="#FF6B35" onClick={() => setOpen(false)}>
                        💣 切换到炸弹人
                      </DropdownItem>
                    </>
                  ) : (
                    <>
                      <DropdownItem href="/snake" accent="#00F5D4" onClick={() => setOpen(false)}>
                        🐍 切换到贪吃蛇
                      </DropdownItem>
                      <DropdownItem href="/bomberman" accent="#FF6B35" onClick={() => setOpen(false)}>
                        💣 切换到炸弹人
                      </DropdownItem>
                    </>
                  )}
                  <div className="mx-3 my-1 border-t-2 border-dashed border-[#FF3AF2]/40" />
                  <button
                    onClick={handleLogout}
                    className="mx-2 mb-2 w-[calc(100%-16px)] rounded-xl px-3 py-2.5 text-left text-sm font-black uppercase tracking-wide text-[#FF6B35] transition-all duration-150 hover:bg-[#FF6B35]/15"
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full border-4 border-dashed border-[#00F5D4] px-4 py-1.5 text-sm font-black uppercase tracking-widest text-[#00F5D4] transition-all duration-200 hover:bg-[#00F5D4]/10 hover:scale-105"
            >
              登录
            </Link>
          )}
        </div>

      </div>
    </nav>
  )
}

/* ── Sub-components ── */

function NavLink({
  href,
  active,
  accent,
  children,
}: {
  href: string
  active: boolean
  accent: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-full px-4 py-2 text-sm font-black uppercase tracking-widest transition-all duration-200"
      style={
        active
          ? {
              color:      accent,
              background: `${accent}18`,
              border:     `2px solid ${accent}`,
              textShadow: `0 0 10px ${accent}80`,
            }
          : {
              color:  "rgba(255,255,255,0.55)",
              border: "2px solid transparent",
            }
      }
      onMouseEnter={e => {
        if (!active) {
          const el = e.currentTarget as HTMLElement
          el.style.color       = accent
          el.style.borderColor = `${accent}50`
          el.style.background  = `${accent}10`
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          const el = e.currentTarget as HTMLElement
          el.style.color       = "rgba(255,255,255,0.55)"
          el.style.borderColor = "transparent"
          el.style.background  = "transparent"
        }
      }}
    >
      {children}
    </Link>
  )
}

function DropdownItem({
  href,
  accent,
  onClick,
  children,
}: {
  href: string
  accent: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition-all duration-150"
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = `${accent}20`
        el.style.color      = accent
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = "transparent"
        el.style.color      = "white"
      }}
    >
      {children}
    </Link>
  )
}
