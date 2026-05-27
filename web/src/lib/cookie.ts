export function setCookie(name: string, value: string, days = 30) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

// 优先读 user_id cookie，没有则从 JWT token 解码 sub 字段并回填
export function getUserId(): string | null {
  const cached = getCookie("user_id")
  if (cached) return cached
  const token = getCookie("token")
  if (!token) return null
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")))
    const uid: string = payload.sub
    if (uid) setCookie("user_id", uid)
    return uid ?? null
  } catch {
    return null
  }
}
