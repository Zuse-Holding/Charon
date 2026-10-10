import { OG_SIZE, ogCard } from "../lib/og-card";

// The preview image when a metisanalytic.com link is shared (Slack,
// LinkedIn, iMessage, X). This is the hub's; Intelligence has its own under
// business-intelligence/.
export const alt = "Metis: Intelligence, Diligence and Committee";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return ogCard({
    title: "Three tools from Metis.",
    body: "Intelligence researches a company. Diligence checks a seller's numbers. Committee grades five AI analysts' stock calls.",
  });
}
