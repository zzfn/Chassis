import { ImageResponse } from "next/og"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "DeepTank — AI 坦克竞技场"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: "#0D0D1A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
        }}
      >
        {/* 背景网格点 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(circle, rgba(255,58,242,0.15) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* 背景斜条纹 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 14px, rgba(255,230,0,0.04) 14px, rgba(255,230,0,0.04) 28px)",
          }}
        />
        {/* 左侧辉光 */}
        <div
          style={{
            position: "absolute",
            top: -100,
            left: -100,
            width: 500,
            height: 500,
            background: "radial-gradient(circle, rgba(255,58,242,0.2) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />
        {/* 右侧辉光 */}
        <div
          style={{
            position: "absolute",
            bottom: -100,
            right: -100,
            width: 400,
            height: 400,
            background: "radial-gradient(circle, rgba(123,47,255,0.25) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* 大坦克图标 */}
        <div
          style={{
            position: "absolute",
            right: 80,
            top: "50%",
            transform: "translateY(-50%)",
            width: 240,
            height: 280,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* 炮管 */}
          <div style={{ position: "absolute", top: 0, left: 107, width: 26, height: 80, background: "linear-gradient(180deg, #FF3AF2, #c026d3)", borderRadius: "13px 13px 8px 8px" }} />
          {/* 炮塔 */}
          <div style={{ position: "absolute", top: 68, left: 52, width: 136, height: 72, background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)", borderRadius: 32 }} />
          <div style={{ position: "absolute", top: 74, left: 68, width: 104, height: 24, background: "rgba(255,255,255,0.1)", borderRadius: 14 }} />
          {/* 车体 */}
          <div style={{ position: "absolute", top: 130, left: 28, width: 184, height: 72, background: "linear-gradient(180deg, #7B2FFF, #4C1D95)", borderRadius: 14 }} />
          {/* 左履带 */}
          <div style={{ position: "absolute", top: 120, left: 8, width: 30, height: 96, background: "#3b0764", borderRadius: 15, border: "3px solid #4C1D95" }} />
          <div style={{ position: "absolute", top: 130, left: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 143, left: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 156, left: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 169, left: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 182, left: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 195, left: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          {/* 右履带 */}
          <div style={{ position: "absolute", top: 120, right: 8, width: 30, height: 96, background: "#3b0764", borderRadius: 15, border: "3px solid #4C1D95" }} />
          <div style={{ position: "absolute", top: 130, right: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 143, right: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 156, right: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 169, right: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 182, right: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", top: 195, right: 10, width: 26, height: 5, background: "#6d28d9", borderRadius: 3, opacity: 0.8 }} />
          {/* 炮口辉光 */}
          <div style={{ position: "absolute", top: -4, left: 100, width: 40, height: 14, background: "rgba(255,58,242,0.7)", borderRadius: 7, filter: "blur(4px)" }} />
        </div>

        {/* 主文字区域 */}
        <div
          style={{
            position: "absolute",
            left: 80,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* 副标题标签 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,58,242,0.15)",
              border: "3px solid rgba(255,58,242,0.5)",
              borderRadius: 100,
              padding: "6px 20px",
            }}
          >
            <div style={{ width: 8, height: 8, background: "#FF3AF2", borderRadius: "50%" }} />
            <span style={{ color: "#FF3AF2", fontSize: 18, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase" }}>
              AI TANK ARENA
            </span>
          </div>

          {/* 主标题 */}
          <div
            style={{
              display: "flex",
              fontSize: 120,
              fontWeight: 900,
              letterSpacing: "-4px",
              lineHeight: 1,
              textTransform: "uppercase",
              color: "white",
              textShadow: "3px 3px 0px #7B2FFF, 6px 6px 0px #FF3AF2",
            }}
          >
            Deep
            <span
              style={{
                background: "linear-gradient(90deg, #FF3AF2, #00F5D4, #FFE600)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Tank
            </span>
          </div>

          {/* 描述 */}
          <div
            style={{
              fontSize: 28,
              color: "rgba(255,255,255,0.55)",
              fontWeight: 500,
              maxWidth: 620,
              lineHeight: 1.5,
            }}
          >
            用代码驾驭坦克，让 AI 决定胜负
          </div>

          {/* 标签组 */}
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            {[
              { label: "JavaScript", color: "#FFE600" },
              { label: "Rust Engine", color: "#FF6B35" },
              { label: "PVP Battle", color: "#00F5D4" },
            ].map(tag => (
              <div
                key={tag.label}
                style={{
                  padding: "8px 20px",
                  borderRadius: 100,
                  border: `3px solid ${tag.color}`,
                  color: tag.color,
                  fontSize: 16,
                  fontWeight: 900,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  background: `${tag.color}18`,
                }}
              >
                {tag.label}
              </div>
            ))}
          </div>
        </div>

        {/* 底部边框线 */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 6,
            background: "linear-gradient(90deg, #FF3AF2, #00F5D4, #FFE600, #FF6B35, #7B2FFF)",
          }}
        />
      </div>
    ),
    { ...size },
  )
}
