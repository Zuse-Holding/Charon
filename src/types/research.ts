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
  insiderActivity: Form4Entry[];
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
  pros?: string[];
  cons?: string[];
  verdict?: string;
  sources: Source[];
}

// --- Person research types ---

export interface PersonProfile {
  name: string;
  currentRole?: string;
  currentCompany?: string;
  summary?: string;
  education?: string;
  netWorth?: string;
  knownFor?: string;
  nationality?: string;
}

export interface CareerEntry {
  title: string;
  company?: string;
  note?: string;
}

// Jackal Person Research (Round 3) — corporate officer/directorship
// records from OpenCorporates. See src/agents/opencorporates-agent.
export interface CorporateAffiliationEntry {
  companyName: string;
  position?: string;
  jurisdiction?: string;
  startDate?: string;
  endDate?: string;
  companyUrl?: string;
}

// MuckRock FOIA request search (Round 3) — Jackal-only, wired into both
// political and person research. See src/agents/muckrock-agent.
export interface FoiaRequestEntry {
  title: string;
  url: string;
  status?: string;
  agency?: string;
  dateSubmitted?: string;
}

export interface PersonAgentResult {
  person: PersonProfile;
  careerHistory: CareerEntry[];
  news: NewsEntry[];
  sources: Source[];
  corporateAffiliations?: CorporateAffiliationEntry[];
  foiaRequests?: FoiaRequestEntry[];
}

export interface PersonResearchBundle {
  query: string;
  generatedAt: string;
  person: PersonProfile;
  careerHistory: CareerEntry[];
  news: NewsEntry[];
  sources: Source[];
  corporateAffiliations?: CorporateAffiliationEntry[];
  foiaRequests?: FoiaRequestEntry[];
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
  type: "company" | "person" | "product" | "political";
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
  federalSpending?: FederalSpendingEntry[];
  insiderActivity?: Form4Entry[];
}

// --- Political research types (Round 2, item 1) ---

export interface PoliticalProfile {
  name: string;
  office?: string;      // e.g. "U.S. Representative"
  party?: string;
  state?: string;
  district?: string;    // e.g. "CA-30"
  incumbent?: boolean;
  summary?: string;
}

export interface DistrictMakeup {
  partisanLean?: string;   // e.g. "R+8", "Lean Democratic", "Toss-up"
  demographics?: string;   // short prose — urban/rural mix, notable industries, etc.
  keyIssues?: string;
}

export interface ApprovalRating {
  value?: string;    // e.g. "42% approve / 51% disapprove"
  source?: string;
  asOf?: string;
}

export interface VotingRecordEntry {
  bill: string;
  position: string;   // "Voted Yes" / "Voted No" / "Did not vote"
  note?: string;
}

export interface CampaignFinanceEntry {
  cycle?: string;      // e.g. "2024"
  totalRaised?: string;
  topDonorTypes?: string;
  note?: string;
}

export interface OppositionResearchEntry {
  topic: string;
  finding: string;
  severity?: RiskLevel;
}

// --- Authoritative political data (Round 2 v2) — real API integrations,
// not search-and-synthesis. These sit alongside (and take priority over)
// the LLM-derived fields above when both are present. See
// src/agents/congress-agent, src/agents/legiscan-agent,
// src/agents/openfec-agent.

export interface SponsoredBillEntry {
  billId: string;            // e.g. "hr1234-118"
  title: string;
  congress?: string;
  introducedDate?: string;
  latestAction?: string;
  latestActionDate?: string;
  url?: string;
}

export interface CommitteeAssignment {
  name: string;
  role?: string;   // "Chair", "Ranking Member", "Member"
}

export interface RollCallVoteEntry {
  bill: string;
  description?: string;
  vote: string;     // "Yea" | "Nay" | "Not Voting" | "Present"
  date?: string;
  chamber?: string;
  url?: string;
}

export interface FecCandidateSummary {
  candidateId: string;
  name: string;
  party?: string;
  cycle?: string;
  totalReceipts?: string;
  totalDisbursements?: string;
  cashOnHand?: string;
}

export interface FecDonorBreakdownEntry {
  employer: string;
  total: string;
}

export interface PoliticalAgentResult {
  profile: PoliticalProfile;
  districtMakeup?: DistrictMakeup;
  approvalRating?: ApprovalRating;
  votingRecord: VotingRecordEntry[];
  campaignFinance: CampaignFinanceEntry[];
  oppositionResearch: OppositionResearchEntry[];
  news: NewsEntry[];
  sources: Source[];
  sponsoredLegislation?: SponsoredBillEntry[];
  committees?: CommitteeAssignment[];
  rollCallVotes?: RollCallVoteEntry[];
  fecSummary?: FecCandidateSummary;
  fecDonorBreakdown?: FecDonorBreakdownEntry[];
  foiaRequests?: FoiaRequestEntry[];
}

export interface PoliticalResearchBundle {
  query: string;
  generatedAt: string;
  profile: PoliticalProfile;
  districtMakeup?: DistrictMakeup;
  approvalRating?: ApprovalRating;
  votingRecord: VotingRecordEntry[];
  campaignFinance: CampaignFinanceEntry[];
  oppositionResearch: OppositionResearchEntry[];
  news: NewsEntry[];
  sources: Source[];
  sponsoredLegislation?: SponsoredBillEntry[];
  committees?: CommitteeAssignment[];
  rollCallVotes?: RollCallVoteEntry[];
  fecSummary?: FecCandidateSummary;
  fecDonorBreakdown?: FecDonorBreakdownEntry[];
  foiaRequests?: FoiaRequestEntry[];
}

// --- USASpending (Round 2, item 3) ---
// Federal contract/award data — free public API, no key required
// (see src/agents/usaspending-agent). Folded into company research so
// it shows up for every tier without any new gating.

export interface FederalSpendingEntry {
  awardId?: string;
  awardingAgency?: string;
  amount?: string;
  date?: string;
  awardType?: string;   // "Contract" | "Grant" | "IDV" etc
  description?: string;
}

export interface USASpendingAgentResult {
  awards: FederalSpendingEntry[];
  sources: Source[];
}

// --- Form 4 / insider trading (Round 2, item 5) ---
// SEC EDGAR Form 4 filings — free public API, no key required
// (see src/agents/form4-agent). Surfaced alongside funding/ownership
// data in the Corporate Agent since it's the same "who owns/controls
// this company" question.

export interface Form4Entry {
  filerName: string;
  relationship?: string;   // "Director", "Officer", "10% Owner", etc.
  transactionType?: string; // "Buy" | "Sell" | "Grant" | "Other"
  shares?: string;
  value?: string;
  date?: string;
  filingUrl?: string;
}
