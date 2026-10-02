import type { Metadata } from "next";

// The Business Intelligence landing page used to be metisanalytic.com/; it
// moved here when the root became the Metis product hub. The page itself
// is a client component, so its metadata lives in this layout.
export const metadata: Metadata = {
  title: "Metis Business Intelligence",
  description:
    "AI-powered business intelligence research on any company, person, or product. Analyst-grade reports in seconds. Built for founders, operators, and BD teams.",
};

export default function BusinessIntelligenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
