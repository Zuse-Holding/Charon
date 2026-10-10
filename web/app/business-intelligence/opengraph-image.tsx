import { OG_SIZE, ogCard } from "../../lib/og-card";

export const alt = "Metis Intelligence: research on any company, person or product";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return ogCard({
    product: "INTELLIGENCE",
    title: "Research any company, person or product.",
    body: "Seven agents cover the website, news, filings, leadership and competitors. Every section shows its sources.",
  });
}
