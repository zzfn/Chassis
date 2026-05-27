export interface EloTier {
  label: string
  color: string
  border: string
}

function subTier(elo: number, min: number, step: number): number {
  return Math.min(5, Math.max(1, 6 - Math.floor((elo - min) / step) - 1))
}

// 各段位在 elo 数轴上的边界，用于计算段内进度条
const TIER_BOUNDS: Record<string, [number, number]> = {
  "王者": [2500, 3000], "大师": [2100, 2500], "钻石": [1800, 2100],
  "铂金": [1500, 1800], "黄金": [1300, 1500], "白银": [1100, 1300], "青铜": [800, 1100],
}

export interface EloTierFull extends EloTier {
  tierName: string  // 段位名，如"铂金"
  subLevel: string  // 子级别数字，如"5"；王者/新兵为""
  progress: number  // 0-99，段内进度
  score: number     // 取整 elo
}

export function getEloFull(elo: number, battles: number): EloTierFull {
  const base = getEloTier(elo, battles)
  const lastChar = base.label.slice(-1)
  const hasNumber = /[1-5]/.test(lastChar)
  const tierName = hasNumber ? base.label.slice(0, -1) : base.label
  const subLevel = hasNumber ? lastChar : ""
  const [min, max] = TIER_BOUNDS[tierName] ?? [800, 1100]
  const adjElo = Math.max(min, Math.min(max, elo))
  const progress = battles === 0 ? 0 : Math.min(99, Math.max(0, Math.round(((adjElo - min) / (max - min)) * 100)))
  return { ...base, tierName, subLevel, progress, score: Math.round(elo) }
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
