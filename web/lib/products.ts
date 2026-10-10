// The Metis product family. Business Intelligence lives in this app;
// Diligence (CIM red-team for small-business acquisitions) and Committee (AI
// stock committee, the separate committee-app project) run as their own apps
// with their own data, so links to them are plain cross-site links.
export const BUSINESS_INTELLIGENCE_PATH = "/business-intelligence";
export const DILIGENCE_URL = "https://diligence.metisanalytic.com";
export const COMMITTEE_URL = "https://committee.metisanalytic.com";

export type ProductId = "intel" | "diligence" | "committee";

// Used to tag and filter /resources posts (frontmatter `product:`) and to pick
// the call to action at the bottom of each post.
export const PRODUCTS: Record<ProductId, { name: string; cta: { title: string; body: string; label: string; href: string } }> = {
  intel: {
    name: "Intelligence",
    cta: { title: "See it on a real company.", body: "Start free. No sales call required.", label: "Start Free →", href: "/login?mode=signup" },
  },
  diligence: {
    name: "Diligence",
    cta: { title: "Run this check on your deal.", body: "Upload the CIM and the returns. Every number in the report cites its page.", label: "Start a report ↗", href: DILIGENCE_URL },
  },
  committee: {
    name: "Committee",
    cta: { title: "Read the meetings yourself.", body: "Every vote, argument and grade is public.", label: "See the track record ↗", href: `${COMMITTEE_URL}/track-record` },
  },
};

export const PRODUCT_IDS = Object.keys(PRODUCTS) as ProductId[];

export function isProductId(v: unknown): v is ProductId {
  return typeof v === "string" && v in PRODUCTS;
}
