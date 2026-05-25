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
  title: "DeepTank",
  description: "用代码驾驭坦克，让 AI 决定胜负",
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
