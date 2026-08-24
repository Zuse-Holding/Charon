import type { Metadata } from "next";
import { ComparisonPage } from "../../../components/marketing/ComparisonPage";

export const metadata: Metadata = {
  title: "PitchBook Alternative — Metis vs. PitchBook",
  description:
    "Looking for a PitchBook alternative? Metis gives you automated, decision-ready research for $19–$149/mo, self-serve — no sales quote, no annual contract.",
  openGraph: {
    title: "PitchBook Alternative — Metis vs. PitchBook",
    description:
      "Self-serve, automated research starting at $19/mo — no sales call, no enterprise contract required.",
    url: "https://metisanalytic.com/vs/pitchbook",
    type: "website",
  },
};

const ROWS = [
  {
    label: "PRICING MODEL",
    metis: "Public, self-serve — $19 to $149/mo",
    competitor: "Not published — sales quote only, typically $12,000–$70,000+/year depending on team size and modules",
  },
  {
    label: "GETTING STARTED",
    metis: "Sign up online, first report in seconds",
    competitor: "Contact sales, negotiate a contract, wait for onboarding and training",
  },
  {
    label: "CONTRACT",
    metis: "Month-to-month, cancel anytime",
    competitor: "Annual contracts standard; multi-year commitments common for discounted rates",
  },
  {
    label: "ENTITY RELATIONSHIPS",
    metis: "Automated Knowledge Graph — built as you research, no extra step",
    competitor: "Deep proprietary datasets, but relationship context relies on analyst research and manual cross-referencing",
  },
  {
    label: "BEST FOR",
    metis: "Individuals, analysts, founders, and small deal teams who need a fast, synthesized answer",
    competitor: "Institutional finance teams that need exhaustive private-market datasets and deal comps at scale",
  },
  {
    label: "ADDING SEATS",
    metis: "Team plan covers 3 seats at $149/mo, additional seats scale linearly",
    competitor: "Additional users typically add several thousand dollars per seat, per year",
  },
];

const NARRATIVE = [
  {
    title: "Enterprise depth without the enterprise sales cycle",
    body: "PitchBook is built for institutional desks that need exhaustive private-market datasets and are willing to pay a five- or six-figure annual contract for it. Metis targets the research question directly — synthesized, decision-ready output — without the procurement process.",
  },
  {
    title: "Automated synthesis instead of a raw dataset",
    body: "PitchBook hands you data; turning it into an answer is still analyst work. Metis's Knowledge Graph and Deep Dive reports do that synthesis automatically, so a founder, analyst, or small deal team gets to a decision without a subscription that requires a budget line of its own.",
  },
];

export default function PitchbookVsPage() {
  return (
    <ComparisonPage
      competitorName="PitchBook"
      badge="PITCHBOOK ALTERNATIVE"
      title="Metis vs."
      titleAccent="PitchBook"
      sub="PitchBook is enterprise-grade and enterprise-priced. Metis gets you to the same kind of decision-ready insight for a fraction of the cost, with no sales call required."
      rows={ROWS}
      narrative={NARRATIVE}
      finalCtaTitle="Skip the sales quote."
      finalCtaSub="Start free — self-serve pricing starting at $19/mo."
    />
  );
}
