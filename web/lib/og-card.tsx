import { ImageResponse } from "next/og";

// Shared layout for the link-preview images (app/opengraph-image.tsx for the
// hub, app/business-intelligence/opengraph-image.tsx for Intelligence).
export const OG_SIZE = { width: 1200, height: 630 };

export function ogCard({ product, title, body }: { product?: string; title: string; body: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          background: "#0A0A0F", color: "#E8E8F0", padding: "72px 80px", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: 10, color: "#FF6B2B" }}>METIS</span>
          {product && <span style={{ fontSize: 22, letterSpacing: 4, color: "#8E8EA3" }}>{product}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 960 }}>{title}</div>
          <div style={{ fontSize: 30, color: "#B8B8C8", maxWidth: 900 }}>{body}</div>
        </div>
        <div style={{ display: "flex", height: 6, width: 160, background: "#00E5FF" }} />
      </div>
    ),
    OG_SIZE,
  );
}
