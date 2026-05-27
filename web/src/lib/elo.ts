export interface EloTier {
  label: string
  color: string
  border: string
}

function subTier(elo: number, min: number, step: number): number {
  return Math.min(5, Math.max(1, 6 - Math.floor((elo - min) / step) - 1))
}

export function getEloTier(elo: number, battles: number): EloTier {
  if (battles === 0) return { label: "新兵", color: "#71717a", border: "border-zinc-600" }
  if (elo >= 2500)   return { label: "王者",  color: "#f43f5e", border: "border-rose-500/60" }
  if (elo >= 2100) {
    const n = subTier(elo, 2100, 80)
    return { label: `大师${n}`, color: "#c084fc", border: "border-purple-500/60" }
  }
  if (elo >= 1800) {
    const n = subTier(elo, 1800, 60)
    return { label: `钻石${n}`, color: "#818cf8", border: "border-indigo-500/60" }
  }
  if (elo >= 1500) {
    const n = subTier(elo, 1500, 60)
    return { label: `铂金${n}`, color: "#67e8f9", border: "border-cyan-700/60" }
  }
  if (elo >= 1300) {
    const n = subTier(elo, 1300, 40)
    return { label: `黄金${n}`, color: "#fbbf24", border: "border-yellow-700/60" }
  }
  if (elo >= 1100) {
    const n = subTier(elo, 1100, 40)
    return { label: `白银${n}`, color: "#a1a1aa", border: "border-zinc-500" }
  }
  const n = subTier(Math.max(800, elo), 800, 60)
  return { label: `青铜${n}`, color: "#c2874f", border: "border-orange-800/60" }
}
