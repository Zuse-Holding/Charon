// Core data models shared across agents.
// These map directly to the spec's per-agent output shapes, plus a Source
// type for citation tracking (built now so Sprint 2's citation engine has
// a stable contract to plug into).

export interface Source {
  url: string;
  title?: string;
  publisher?: string;
  retrievedAt: string; // ISO timestamp
  usedFor: string[]; // which sections this source supports, e.g. ["overview", "products"]
}

export interface CompanyProfile {
  name: string;
  description?: string;
  website?: string;
  founded?: string;
  headquarters?: string;
  industry?: string;
}

export interface LeadershipEntry {
  name: string;
  title: string;
  bio?: string;
}

export interface ProductEntry {
  name: string;
  category?: string;
  description?: string;
  pricingModel?: string;
  targetCustomer?: string;
}

export interface NewsEntry {
  headline: string;
  date?: string;
  summary?: string;
  url?: string;
}

export interface FundingEntry {
  round?: string;
  amount?: string;
  date?: string;
  investors?: string[];
}

export interface WebsiteAgentResult {
  company: CompanyProfile;
  leadership: LeadershipEntry[];
  products: ProductEntry[];
  sources: Source[];
}

export interface NewsAgentResult {
  news: NewsEntry[];
  sources: Source[];
}

export interface CorporateAgentResult {
  funding: FundingEntry[];
  ownership?: string;
  sources: Source[];
}

export interface CompetitorEntry {
  name: string;
  note?: string;
  url?: string;
}

export interface CompetitorAgentResult {
  competitors: CompetitorEntry[];
  sources: Source[];
}

// --- Product research types ---

export interface ProductProfile {
  name: string;
  brand?: string;
  category?: string;
  price?: string;
  description?: string;
}

export interface ProductSpec {
  label: string;
  value: string;
}

export interface ProductCompetitorEntry {
  name: string;
  note?: string;
}

export interface ProductResearchBundle {
  query: string;
  generatedAt: string;
  product: ProductProfile;
  specs: ProductSpec[];
  competitors: ProductCompetitorEntry[];
  news: NewsEntry[];
  risks?: string[];
  opportunities?: string[];
  sources: Source[];
}

// --- Person research types ---

export interface PersonProfile {
  name: string;
  currentRole?: string;
  currentCompany?: string;
  summary?: string;
}

export interface CareerEntry {
  title: string;
  company?: string;
  note?: string;
}

export interface PersonAgentResult {
  person: PersonProfile;
  careerHistory: CareerEntry[];
  news: NewsEntry[];
  sources: Source[];
}

export interface PersonResearchBundle {
  query: string;
  generatedAt: string;
  person: PersonProfile;
  careerHistory: CareerEntry[];
  news: NewsEntry[];
  sources: Source[];
}

// --- Deep Dive types ---

export type RiskLevel = "high" | "medium" | "low";

export interface DeepDiveSection {
  title: string;
  content: string; // markdown prose
  riskLevel?: RiskLevel; // only for Risk Flags section
}

export interface DeepDiveBundle {
  id: string;
  company: string;
  generatedAt: string;
  durationMs: number;
  sections: DeepDiveSection[];
}

export interface WatchlistEntry {
  id: string;
  type: "company" | "person" | "product";
  subject: string;
  addedAt: string;
  lastRefreshedAt?: string;
  refreshIntervalDays: number; // how stale before flagging
}

// Aggregate object the Orchestrator builds and hands to the Report Agent.
export interface ResearchBundle {
  query: string;
  generatedAt: string;
  company: CompanyProfile;
  leadership: LeadershipEntry[];
  products: ProductEntry[];
  news: NewsEntry[];
  funding: FundingEntry[];
  competitors: CompetitorEntry[];
  ownership?: string;
  sources: Source[];
  risks?: string[];
  opportunities?: string[];
}
