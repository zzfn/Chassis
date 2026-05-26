export const metadata = {
  title: { template: "%s · DeepBomber", default: "DeepBomber" },
}
export default function BombermanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
