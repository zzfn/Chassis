import { Trophy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export default function TournamentPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-950 px-4 text-center">
      <div className="relative flex flex-col items-center gap-6">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_40%_at_50%_50%,rgba(234,179,8,0.08),transparent)]" />

        <div className="flex size-20 items-center justify-center rounded-2xl border border-yellow-500/20 bg-yellow-500/10">
          <Trophy className="size-10 text-yellow-400" />
        </div>

        <div className="flex flex-col items-center gap-2">
          <Badge
            variant="outline"
            className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
          >
            即将上线
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight text-white md:text-5xl">
            锦标赛
          </h1>
          <p className="mt-2 max-w-md text-base text-zinc-400">
            精英赛制、积分晋级、冠军奖池——全面对抗系统正在开发中，敬请期待。
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          {[
            { label: "赛制", value: "单败淘汰" },
            { label: "赛季", value: "每月一届" },
            { label: "奖励", value: "积分 + 徽章" },
          ].map(({ label, value }) => (
            <Card
              key={label}
              size="sm"
              className="border border-zinc-800 bg-zinc-900 ring-0"
            >
              <CardContent>
                <p className="text-lg font-bold text-white">{value}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
