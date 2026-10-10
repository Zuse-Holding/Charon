import type { Metadata } from "next";

// The Business Intelligence landing page used to be metisanalytic.com/; it
// moved here when the root became the Metis product hub. The page itself
// is a client component, so its metadata lives in this layout.
export const metadata: Metadata = {
  title: "Metis Intelligence",
  description:
    "Research any company, person or product. Every section of the report shows its sources. Built for founders, operators and BD teams.",
};

export default function BusinessIntelligenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
