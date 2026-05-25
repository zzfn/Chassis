import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#0D0D1A",
          borderRadius: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 背景辉光 */}
        <div
          style={{
            position: "absolute",
            width: 130,
            height: 130,
            background:
              "radial-gradient(circle, rgba(255,58,242,0.18) 0%, rgba(123,47,255,0.12) 50%, transparent 80%)",
            top: 25,
            left: 25,
            borderRadius: "50%",
          }}
        />
        {/* 炮管 */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 77,
            width: 26,
            height: 58,
            background: "linear-gradient(180deg, #FF3AF2 0%, #c026d3 100%)",
            borderRadius: "13px 13px 8px 8px",
          }}
        />
        {/* 炮塔 */}
        <div
          style={{
            position: "absolute",
            top: 58,
            left: 42,
            width: 96,
            height: 52,
            background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
            borderRadius: 24,
          }}
        />
        {/* 炮塔高光 */}
        <div
          style={{
            position: "absolute",
            top: 62,
            left: 50,
            width: 80,
            height: 18,
            background: "rgba(255,255,255,0.12)",
            borderRadius: 10,
          }}
        />
        {/* 车体 */}
        <div
          style={{
            position: "absolute",
            top: 100,
            left: 22,
            width: 136,
            height: 52,
            background: "linear-gradient(180deg, #7B2FFF 0%, #4C1D95 100%)",
            borderRadius: 10,
          }}
        />
        {/* 左履带 */}
        <div
          style={{
            position: "absolute",
            top: 92,
            left: 8,
            width: 22,
            height: 72,
            background: "#3b0764",
            borderRadius: 11,
            border: "2px solid #4C1D95",
          }}
        />
        {/* 左履带纹 */}
        <div style={{ position: "absolute", top: 100, left: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 109, left: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 118, left: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 127, left: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 136, left: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        {/* 右履带 */}
        <div
          style={{
            position: "absolute",
            top: 92,
            right: 8,
            width: 22,
            height: 72,
            background: "#3b0764",
            borderRadius: 11,
            border: "2px solid #4C1D95",
          }}
        />
        {/* 右履带纹 */}
        <div style={{ position: "absolute", top: 100, right: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 109, right: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 118, right: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 127, right: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 136, right: 9, width: 20, height: 3, background: "#6d28d9", borderRadius: 2, opacity: 0.7 }} />
        {/* 炮管炮口光圈 */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 75,
            width: 30,
            height: 10,
            background: "rgba(255,58,242,0.6)",
            borderRadius: 5,
            filter: "blur(3px)",
          }}
        />
      </div>
    ),
    { ...size },
  )
}
