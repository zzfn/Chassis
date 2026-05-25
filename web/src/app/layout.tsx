import { Suspense } from "react"
import type { Metadata } from "next"
import { Outfit, DM_Sans, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Navbar } from "@/components/navbar"

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
})

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "DeepTank",
    template: "%s · DeepTank",
  },
  description: "用代码驾驭坦克，让 AI 决定胜负 — 在 Rust 引擎驱动的竞技场中，以 JavaScript 编写你的 AI 坦克参与 PVP 对战。",
  keywords: ["AI", "坦克", "竞技场", "JavaScript", "编程", "对战"],
  openGraph: {
    type: "website",
    siteName: "DeepTank",
    title: "DeepTank — AI 坦克竞技场",
    description: "用代码驾驭坦克，让 AI 决定胜负",
  },
  twitter: {
    card: "summary_large_image",
    title: "DeepTank — AI 坦克竞技场",
    description: "用代码驾驭坦克，让 AI 决定胜负",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${dmSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0D0D1A] text-white">
        <Navbar />
        <Suspense>{children}</Suspense>
      </body>
    </html>
  )
}
