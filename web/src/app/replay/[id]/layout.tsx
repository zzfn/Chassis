import type { Metadata } from "next"

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  try {
    const { id } = await params
    const res = await fetch(`${apiBase}/api/replay/${id}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { title: "回放" }
    const data = await res.json()
    const tanks: { name: string; team_id?: number }[] = data.telemetry?.[0]?.tanks ?? []
    if (tanks.length === 0) return { title: "回放" }

    // 2v2：按队伍分组，队内用 & 连接，队间用 vs
    const teams = new Map<number, string[]>()
    let hasTeams = false
    for (const t of tanks) {
      if (t.team_id != null) {
        hasTeams = true
        const arr = teams.get(t.team_id) ?? []
        arr.push(t.name)
        teams.set(t.team_id, arr)
      }
    }
    const title = hasTeams
      ? [...teams.values()].map(g => g.join(" & ")).join(" vs ")
      : tanks.map(t => t.name).join(" vs ")

    return { title }
  } catch {
    return { title: "回放" }
  }
}

export default function L({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
