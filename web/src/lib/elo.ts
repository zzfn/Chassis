export interface EloTier {
  label: string
  color: string
  border: string
}

export function getEloTier(elo: number, battles: number): EloTier {
  if (battles === 0) return { label: "新兵", color: "#71717a", border: "border-zinc-600" }
  if (elo >= 1800)   return { label: "钻石", color: "#818cf8", border: "border-indigo-500/60" }
  if (elo >= 1500)   return { label: "铂金", color: "#67e8f9", border: "border-cyan-700/60" }
  if (elo >= 1300)   return { label: "黄金", color: "#fbbf24", border: "border-yellow-700/60" }
  if (elo >= 1100)   return { label: "白银", color: "#a1a1aa", border: "border-zinc-500" }
  return              { label: "青铜", color: "#c2874f", border: "border-orange-800/60" }
}
