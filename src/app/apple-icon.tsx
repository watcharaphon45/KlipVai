import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
          borderRadius: 40,
        }}
      >
        <div
          style={{
            width: 76,
            height: 126,
            borderRadius: 14,
            border: "8px solid #ffffff",
            background: "rgba(9, 9, 11, 0.25)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderTop: "18px solid transparent",
              borderBottom: "18px solid transparent",
              borderLeft: "30px solid #ffffff",
              marginLeft: 6,
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
