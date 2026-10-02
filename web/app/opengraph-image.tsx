import { ImageResponse } from "next/og";

// The preview image when a metisanalytic.com link is shared (Slack,
// LinkedIn, iMessage, X). Before this, shared links showed no image.
export const alt = "Metis: research on any company, person or product";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          <span style={{ fontSize: 22, letterSpacing: 4, color: "#6B6B80" }}>BUSINESS INTELLIGENCE</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 960 }}>
            Research any company, person or product.
          </div>
          <div style={{ fontSize: 30, color: "#B8B8C8", maxWidth: 900 }}>
            Seven agents cover the website, news, filings, leadership and competitors. One sourced report back.
          </div>
        </div>
        <div style={{ display: "flex", height: 6, width: 160, background: "#00E5FF" }} />
      </div>
    ),
    size,
  );
}
