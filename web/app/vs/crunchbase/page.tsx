import type { Metadata } from "next";
import { ComparisonPage } from "../../../components/marketing/ComparisonPage";

export const metadata: Metadata = {
  title: "Crunchbase Alternative — Metis vs. Crunchbase",
  description:
    "Looking for a Crunchbase alternative? Metis fuses public sources into one synthesized report instead of a data directory you have to piece together yourself.",
  openGraph: {
    title: "Crunchbase Alternative — Metis vs. Crunchbase",
    description:
      "Metis fuses public sources into one synthesized report. Crunchbase gives you data points to piece together yourself.",
    url: "https://metisanalytic.com/vs/crunchbase",
    type: "website",
  },
};

const ROWS = [
  {
    label: "PRICING MODEL",
    metis: "Flat, self-serve — $19 to $149/mo",
    competitor: "Per-seat — Starter ~$49/user/mo, Pro ~$99/mo, Business ~$199/mo (billed annually for the lowest rate)",
  },
  {
    label: "WHAT YOU GET",
    metis: "One synthesized report per entity, built from web, news, and public filings",
    competitor: "A company profile page — firmographic data points you read and connect yourself",
  },
  {
    label: "ANALYSIS DEPTH",
    metis: "Deep Dive: founding history, leadership, funding history, market sizing, competitive context, and a strategic verdict",
    competitor: "Funding rounds, contact info, and growth signals — no synthesized narrative or verdict",
  },
  {
    label: "ENTITY RELATIONSHIPS",
    metis: "Automated Knowledge Graph — every entity you research connects into one queryable map",
    competitor: "Manual — you cross-reference profiles and build the picture yourself",
  },
  {
    label: "COVERAGE",
    metis: "Companies, people, and products from open web and public sources",
    competitor: "Primarily companies and investors, sourced from self-reported and public filing data",
  },
  {
    label: "GETTING STARTED",
    metis: "Sign up, no credit card, first report in seconds",
    competitor: "Free tier is heavily capped; full plans require a paid subscription",
  },
];

const NARRATIVE = [
  {
    title: "Data fusion, not just data access",
    body: "Crunchbase is a directory — it's built to be searched and browsed. Metis is built to be read: every source it touches (news, filings, the company's own site, public records) gets synthesized into one decision-ready report, so you're not the one doing the analyst work.",
  },
  {
    title: "A Knowledge Graph that builds itself",
    body: "On Crunchbase, mapping how a company connects to its competitors, leadership, and investors is a manual exercise across multiple profile pages. Metis builds that relationship map automatically as you research, so cross-entity context is there without extra work.",
  },
];

export default function CrunchbaseVsPage() {
  return (
    <ComparisonPage
      competitorName="Crunchbase"
      badge="CRUNCHBASE ALTERNATIVE"
      title="Metis vs."
      titleAccent="Crunchbase"
      sub="Crunchbase gives you access to data. Metis gives you the answer — synthesized from that data automatically, at a fraction of the seat-based cost."
      rows={ROWS}
      narrative={NARRATIVE}
      finalCtaTitle="Get the synthesis, not just the search results."
      finalCtaSub="Start free — no credit card, no per-seat pricing."
    />
  );
}
