import { ImageResponse } from "next/og"

export const size = { width: 32, height: 32 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#0D0D1A",
          borderRadius: 7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 炮管 */}
        <div
          style={{
            position: "absolute",
            top: 1,
            left: 13,
            width: 6,
            height: 12,
            background: "#FF3AF2",
            borderRadius: "3px 3px 2px 2px",
          }}
        />
        {/* 炮塔 */}
        <div
          style={{
            position: "absolute",
            top: 9,
            left: 7,
            width: 18,
            height: 9,
            background: "linear-gradient(135deg, #FF3AF2, #7B2FFF)",
            borderRadius: 5,
          }}
        />
        {/* 车体 */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 5,
            width: 22,
            height: 9,
            background: "#7B2FFF",
            borderRadius: 2,
          }}
        />
        {/* 左履带 */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 2,
            width: 4,
            height: 14,
            background: "#4C1D95",
            borderRadius: 2,
          }}
        />
        {/* 右履带 */}
        <div
          style={{
            position: "absolute",
            top: 14,
            right: 2,
            width: 4,
            height: 14,
            background: "#4C1D95",
            borderRadius: 2,
          }}
        />
        {/* 炮塔光晕 */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 9,
            width: 14,
            height: 4,
            background: "rgba(255,58,242,0.35)",
            borderRadius: 3,
          }}
        />
      </div>
    ),
    { ...size },
  )
}
