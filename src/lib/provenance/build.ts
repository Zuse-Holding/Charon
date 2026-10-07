import type { PersonResearchBundle, ResearchBundle, Source } from "../../types/research.js";
import { numericTerms, traceFindings, type Candidate, type Fallback, type Finding } from "./findings.js";
import type { Snapshot } from "./snapshots.js";

/**
 * Turns a finished research bundle into findings with provenance. Each
 * report section's claims become candidates, then findings.ts traces them
 * to the responses the run actually received.
 *
 * Method per section: structured public-record APIs (sanctions lists,
 * ProPublica, LittleSis, USAspending, OpenCorporates, MuckRock, SEC Form 4,
 * the Wayback Machine) and search results are "api"; anything an LLM read
 * out of a page (profile facts, leadership, products, competitors, funding,
 * risks) is "ai_extracted".
 */

export interface ProvenanceRecord {
  findings: Finding[];
  counts: Record<Finding["verification"], number>;
  /** How many source responses were stored for this run. */
  snapshotCount: number;
  /** Claims with no usable source link anywhere in the run. */
  untraceable: number;
}

export interface BuiltProvenance {
  record: ProvenanceRecord;
  /** Every snapshot to store: the ones fetched plus stand-ins for claims
   *  no response contained. */
  snapshots: Snapshot[];
}

// Report section -> the Source.usedFor tags its sources carry (see
// report-agent's pushSectionSources calls).
const SECTION_TAGS: Record<string, string[]> = {
  "Company Overview": ["overview"],
  "Leadership": ["leadership"],
  "Products": ["products"],
  "Competitors": ["competitors"],
  "Funding": ["funding"],
  "Risks": ["risks", "overview"],
  "Opportunities": ["opportunities", "overview"],
  "Recent News": ["news"],
  "Federal Spending": ["federal-spending"],
  "Insider Activity": ["insider-activity"],
  "About": ["bio", "background"],
  "Current Role": ["bio"],
  "Career History": ["bio", "background"],
  "Corporate Affiliations": ["corporate-affiliations"],
  "FOIA Requests": ["foia-requests"],
};

function fallbackFrom(sources: Source[]) {
  return (section: string): Fallback | undefined => {
    const tags = SECTION_TAGS[section] ?? [];
    const s = sources.find((x) => x.usedFor.some((u) => tags.includes(u))) ?? sources[0];
    return s ? { url: s.url, name: s.publisher ?? s.title } : undefined;
  };
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function publicRecordCandidates(b: Pick<ResearchBundle, "sanctionsMatches" | "nonprofitFilings" | "powerMapConnections">): Candidate[] {
  const out: Candidate[] = [];
  for (const m of b.sanctionsMatches ?? []) {
    out.push({ section: "Public Records", claim: `Possible sanctions match: ${m.name} (${m.source})`, terms: [m.name],
      method: "api", recordUrl: m.url, sourceName: `${m.source} sanctions list` });
  }
  for (const n of b.nonprofitFilings ?? []) {
    out.push({ section: "Public Records", claim: `Nonprofit filing: ${n.name} (EIN ${n.ein})`, terms: [n.ein.replace(/\D/g, "")],
      method: "api", recordUrl: n.url, sourceName: "ProPublica Nonprofit Explorer" });
  }
  for (const p of b.powerMapConnections ?? []) {
    out.push({ section: "Public Records", claim: `Power-map connection: ${p.name}`, terms: [p.name],
      method: "api", recordUrl: p.url, sourceName: "LittleSis" });
  }
  return out;
}

function summarize(findings: Finding[], snapshots: Snapshot[], untraceable: number): ProvenanceRecord {
  const counts = { confirmed: 0, single_source: 0, unverified: 0 };
  for (const f of findings) counts[f.verification] += 1;
  return { findings, counts, snapshotCount: snapshots.filter((s) => !s.generated).length, untraceable };
}

export function buildCompanyProvenance(b: ResearchBundle, snapshots: Snapshot[]): BuiltProvenance {
  const c: Candidate[] = [];
  const co = b.company;
  if (co.founded) c.push({ section: "Company Overview", claim: `Founded: ${clean(co.founded)}`, terms: [co.founded], method: "ai_extracted" });
  if (co.headquarters) c.push({ section: "Company Overview", claim: `Headquarters: ${clean(co.headquarters)}`, terms: [co.headquarters], method: "ai_extracted" });
  if (co.industry) c.push({ section: "Company Overview", claim: `Industry: ${clean(co.industry)}`, terms: [co.industry], method: "ai_extracted" });
  for (const l of b.leadership) {
    c.push({ section: "Leadership", claim: `${clean(l.name)} — ${clean(l.title)}`, terms: [l.name], method: "ai_extracted" });
  }
  for (const p of b.products) c.push({ section: "Products", claim: clean(p.name), terms: [p.name], method: "ai_extracted" });
  for (const x of b.competitors) {
    c.push({ section: "Competitors", claim: clean(x.name), terms: [x.name], method: "ai_extracted", recordUrl: x.url });
  }
  for (const f of b.funding) {
    const claim = [f.round, f.amount, f.date].filter(Boolean).join(", ");
    const term = f.amount ?? f.round;
    if (claim) c.push({ section: "Funding", claim, terms: term ? [term] : [], method: "ai_extracted" });
  }
  for (const r of b.risks ?? []) c.push({ section: "Risks", claim: clean(r), terms: numericTerms(r), method: "ai_extracted" });
  for (const o of b.opportunities ?? []) c.push({ section: "Opportunities", claim: clean(o), terms: numericTerms(o), method: "ai_extracted" });
  for (const n of b.news) {
    c.push({ section: "Recent News", claim: clean(n.headline), terms: [n.headline], method: "api", recordUrl: n.url });
  }
  for (const s of b.federalSpending ?? []) {
    const claim = [s.awardType, s.awardingAgency, s.amount, s.date].filter(Boolean).join(", ");
    if (claim) c.push({ section: "Federal Spending", claim, terms: s.awardId ? [s.awardId] : [], method: "api", sourceName: "USAspending.gov" });
  }
  for (const i of b.insiderActivity ?? []) {
    const claim = [i.filerName, i.relationship, i.transactionType, i.value, i.date].filter(Boolean).join(", ");
    c.push({ section: "Insider Activity", claim, terms: [i.filerName], method: "api", recordUrl: i.filingUrl, sourceName: "SEC Form 4" });
  }
  c.push(...publicRecordCandidates(b));
  if (b.webArchive?.firstSnapshot) {
    c.push({ section: "Public Records", claim: `First archived ${b.webArchive.firstSnapshot.timestamp.slice(0, 8)}`,
      terms: [b.webArchive.firstSnapshot.timestamp], method: "api", recordUrl: b.webArchive.firstSnapshot.url, sourceName: "Internet Archive" });
  }

  const { findings, generated, untraceable } = traceFindings(c, snapshots, fallbackFrom(b.sources));
  return { record: summarize(findings, snapshots, untraceable), snapshots: [...snapshots, ...generated] };
}

export function buildPersonProvenance(b: PersonResearchBundle, snapshots: Snapshot[]): BuiltProvenance {
  const c: Candidate[] = [];
  const p = b.person;
  if (p.currentRole || p.currentCompany) {
    const claim = [p.currentRole, p.currentCompany].filter(Boolean).join(", ");
    c.push({ section: "Current Role", claim, terms: p.currentCompany ? [p.currentCompany] : [p.currentRole!], method: "ai_extracted" });
  }
  if (p.education) c.push({ section: "About", claim: `Education: ${clean(p.education)}`, terms: [p.education], method: "ai_extracted" });
  if (p.netWorth) c.push({ section: "About", claim: `Net worth: ${clean(p.netWorth)}`, terms: numericTerms(p.netWorth), method: "ai_extracted" });
  for (const e of b.careerHistory) {
    const claim = [e.title, e.company].filter(Boolean).join(", ");
    c.push({ section: "Career History", claim, terms: e.company ? [e.company] : [e.title], method: "ai_extracted" });
  }
  for (const a of b.corporateAffiliations ?? []) {
    const claim = [a.companyName, a.position, a.jurisdiction].filter(Boolean).join(", ");
    c.push({ section: "Corporate Affiliations", claim, terms: [a.companyName], method: "api", recordUrl: a.companyUrl, sourceName: "OpenCorporates" });
  }
  for (const f of b.foiaRequests ?? []) {
    c.push({ section: "FOIA Requests", claim: clean(f.title), terms: [f.title], method: "api", recordUrl: f.url, sourceName: "MuckRock" });
  }
  for (const n of b.news) {
    c.push({ section: "Recent News", claim: clean(n.headline), terms: [n.headline], method: "api", recordUrl: n.url });
  }
  c.push(...publicRecordCandidates(b));

  const { findings, generated, untraceable } = traceFindings(c, snapshots, fallbackFrom(b.sources));
  return { record: summarize(findings, snapshots, untraceable), snapshots: [...snapshots, ...generated] };
}
