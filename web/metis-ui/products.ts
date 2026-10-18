// The Metis family, named one way everywhere. Every site's header switcher
// and footer read from here, so a product is never "Intelligence" on one
// site and "Metis research" on another.

export type ProductKey = "hub" | "intelligence" | "diligence" | "committee";

export interface Product {
  key: Exclude<ProductKey, "hub">;
  name: string;
  /** One line for the product switcher. */
  blurb: string;
  url: string;
}

export const HUB_URL = "https://metisanalytic.com";
export const SUPPORT_EMAIL = "support@metisanalytic.com";
export const LEGAL_ENTITY = "Zuse Holdings LLC";

export const PRODUCTS: Product[] = [
  {
    key: "intelligence",
    name: "Intelligence",
    blurb: "Research a company, person or product, with every source shown.",
    url: "https://metisanalytic.com/business-intelligence",
  },
  {
    key: "diligence",
    name: "Diligence",
    blurb: "Red-team a CIM and financials before you sign an LOI.",
    url: "https://diligence.metisanalytic.com",
  },
  {
    key: "committee",
    name: "Committee",
    blurb: "Watch an AI investment committee argue, decide and get graded.",
    url: "https://committee.metisanalytic.com",
  },
];

export function productName(key: ProductKey): string {
  return key === "hub" ? "Metis" : PRODUCTS.find((p) => p.key === key)!.name;
}

/** Committee's disclosures are the family's investing disclosures. */
export const DISCLOSURES_URL = "https://committee.metisanalytic.com/disclosures";
