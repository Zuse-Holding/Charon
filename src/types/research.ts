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
  /** School/employer/org typed alongside the name to disambiguate a
   *  common name (e.g. "CSUN"), parsed out of the raw search query by
   *  parsePersonQuery — see src/lib/nlp.ts. Not guessed if absent. */
  affiliation?: string;
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

// Charon Person Research (Round 3) — corporate officer/directorship
// records from OpenCorporates. See src/agents/opencorporates-agent.
export interface CorporateAffiliationEntry {
  companyName: string;
  position?: string;
  jurisdiction?: string;
  startDate?: string;
  endDate?: string;
  companyUrl?: string;
}

// MuckRock FOIA request search (Round 3) — Charon-only, wired into both
// political and person research. See src/agents/muckrock-agent.
export interface FoiaRequestEntry {
  title: string;
  url: string;
  status?: string;
  agency?: string;
  dateSubmitted?: string;
}

// CourtListener RECAP/docket search (Charon Person Research) — federal
// litigation records, mirrors much of what PACER holds. See
// src/agents/courtlistener-agent.
export interface CourtListenerRecord {
  caseName: string;
  url: string;
  court?: string;
  dateFiled?: string;
  docketNumber?: string;
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
  // 7/20 public-record fusion sources — Pro/Team+ only (publicRecordsAccess),
  // except offshoreLeaksMatches which is Charon/internal-only (deep mode).
  sanctionsMatches?: SanctionsMatch[];
  nonprofitFilings?: NonprofitFilingEntry[];
  powerMapConnections?: PowerMapEntry[];
  offshoreLeaksMatches?: OffshoreLeakMatch[];
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
  type: "company" | "person" | "product" | "political" | "creator";
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
  // 7/20 public-record fusion sources — Pro/Team+ only (publicRecordsAccess),
  // except offshoreLeaksMatches which is Charon/internal-only.
  sanctionsMatches?: SanctionsMatch[];
  webArchive?: WebArchiveSummary;
  nonprofitFilings?: NonprofitFilingEntry[];
  powerMapConnections?: PowerMapEntry[];
  offshoreLeaksMatches?: OffshoreLeakMatch[];
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
  education?: string;
  // Best-effort classification used to route which API sources get
  // called (Congress.gov/OpenFEC are federal-only, LegiScan is state
  // legislators, statewide-executives table is governors/AG/SoS/etc).
  // "unknown" falls back to trying every source, same as before this
  // existed — this only ever narrows dispatch, never blocks a source.
  // See src/lib/office-classifier.ts.
  officeType?: "federal" | "state-legislator" | "statewide-executive" | "local" | "unknown";
  // Set when the exact queried name never appears in any gathered
  // source text — a strong signal the search engine fuzzy-matched to a
  // different (if similar-sounding) real person. When set, no profile
  // fields or opposition-research findings are synthesized from search
  // results, to avoid attributing a real person's facts/allegations to
  // the wrong name. See src/agents/political-agent.
  nameMismatchWarning?: string;
  // Set when no source (search-synthesis, Congress.gov, OpenFEC,
  // LegiScan, or the statewide-executives table) could confirm even
  // basic office/party/state for this person — an explicit "we don't
  // have this" flag instead of a silently blank or LLM-guessed profile.
  // Matches the ENTITY_OVERRIDES philosophy: say what you don't know
  // rather than paper over the gap.
  dataUnavailable?: boolean;
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

// --- Sanctions screening (7/20 public-record fusion, roadmap #1) ---
// Consolidated Screening List — Commerce/State/Treasury's combined feed
// of 11 export-control and sanctions lists (including OFAC's SDN list),
// via api.trade.gov. Free key required (TRADE_GOV_API_KEY). Pro/Team+
// only — see TierConfig.publicRecordsAccess.
export interface SanctionsMatch {
  name: string;
  source: string;       // which of the 11 lists matched, e.g. "SDN", "Entity List"
  type?: string;         // "Individual" | "Entity" | "Vessel" | "Aircraft"
  programs?: string[];   // sanction program codes, e.g. ["SDGT", "UKRAINE-EO13662"]
  remarks?: string;
  url?: string;
}

export interface SanctionsAgentResult {
  matches: SanctionsMatch[];
  sources: Source[];
}

// --- Wayback Machine archive history (7/20 public-record fusion, roadmap #2) ---
// web.archive.org's Availability + CDX APIs, no key required. Company
// research only for now — see src/agents/wayback-agent.
export interface ArchiveSnapshot {
  timestamp: string;   // wayback 14-digit timestamp, e.g. "20200101120000"
  url: string;          // full wayback URL to view this snapshot
}

export interface WebArchiveSummary {
  firstSnapshot?: ArchiveSnapshot;
  latestSnapshot?: ArchiveSnapshot;
  snapshotCount?: number;
}

export interface WaybackAgentResult {
  summary: WebArchiveSummary;
  sources: Source[];
}

// --- ProPublica Nonprofit Explorer (7/20 public-record fusion) ---
// 990-filing lookup, no key required. Relevant to both company and
// person research (board/officer affiliations, or the entity itself
// being a registered nonprofit).
export interface NonprofitFilingEntry {
  ein: string;
  name: string;
  ntee?: string;          // NTEE classification code, e.g. "B25" (education)
  totalRevenue?: string;
  taxPeriod?: string;
  url: string;
}

export interface NonprofitAgentResult {
  organizations: NonprofitFilingEntry[];
  sources: Source[];
}

// --- LittleSis power-mapping (7/20 public-record fusion, roadmap #3 —
// cross-entity resolution layer). No key required. Pro/Team+ — see
// TierConfig.publicRecordsAccess.
export interface PowerMapEntry {
  name: string;
  entityKind?: string;   // "Person" | "Org"
  blurb?: string;
  url: string;
}

export interface LittleSisAgentResult {
  matches: PowerMapEntry[];
  sources: Source[];
}

// --- ICIJ Offshore Leaks (7/20 public-record fusion) — Charon-tier only.
// Reconciliation API match candidates against Pandora/Paradise/Panama/
// Bahamas/Offshore Leaks. No key required, but these are fuzzy-match
// candidates, not confirmed hits — always presented as "possible
// matches," never asserted as fact. See src/agents/icij-agent.
export interface OffshoreLeakMatch {
  name: string;
  entityType?: string;   // reconciliation schema type: Entity/Officer/Intermediary/Address/Other
  score?: number;         // reconciliation API match confidence, 0-100
  url: string;
}

export interface IcijAgentResult {
  matches: OffshoreLeakMatch[];
  sources: Source[];
}

// --- Creator / Market-Signal Intelligence (roadmap #1, general v1) ---
// General, multi-industry version of the bespoke TikTok tool in
// src/agents/creator-agent (hardcoded to GLP-1/weight-loss hashtags, paid
// unofficial RapidAPI scraper — see that file's doc comment). This is
// search-synthesis (same pattern as political-agent) plus one real free
// API — YouTube Data API for subscriber/view counts, the one
// authoritative hard-numbers source here — and a best-effort Google
// Trends read for rising/falling interest. TikTok/Instagram/X follower
// stats have no reliable free API for arbitrary accounts, so this
// intentionally doesn't attempt them; see docs/next-verticals-scoping.md.
// See src/agents/creator-signal-agent.

export interface CreatorProfile {
  name: string;
  handle?: string;    // e.g. "@mkbhd" — only if a specific platform handle was identified in source text
  platform?: string;  // "YouTube" | "TikTok" | "Instagram" | "X" | etc — best-effort from source text
  category?: string;  // niche/vertical, e.g. "tech reviews", "GLP-1/weight-loss"
  summary?: string;
  knownFor?: string;
}

export interface YoutubeChannelStats {
  channelId: string;
  channelTitle: string;
  subscriberCount?: string;
  viewCount?: string;
  videoCount?: string;
  publishedAt?: string; // channel creation date
  url: string;
}

export interface TrendPoint {
  date: string;     // ISO date
  interest: number; // Google Trends 0-100 relative interest
}

export interface TrendSummary {
  keyword: string;
  points: TrendPoint[];
  direction?: "rising" | "falling" | "flat";
  averageInterest?: number;
}

export interface CreatorSignalEntry {
  topic: string; // what's being said, e.g. "sponsorship backlash", "viral growth"
  finding: string;
  sentiment?: "positive" | "negative" | "neutral" | "mixed";
}

// Raw, unsynthesized search hits on tiktok.com/instagram.com — deliberately
// NOT run through the LLM like `signals` above. A direct link to the actual
// post is sharper evidence than a paraphrase, and it's the free
// alternative to a paid TikTok/Instagram data API (Modash, HypeAuditor,
// etc — no reliable free API exists for either platform's follower/post
// data on an arbitrary account, see docs/next-verticals-scoping.md).
// Filtered to recent activity (see fetchShortFormMentions) since the
// whole point is catching what's happening *now*, not a historical
// archive.
export interface ShortFormMention {
  platform: "tiktok" | "instagram";
  title: string;
  url: string;
  snippet?: string;
}

export interface CreatorAgentResult {
  profile: CreatorProfile;
  youtubeStats?: YoutubeChannelStats;
  trend?: TrendSummary;
  signals: CreatorSignalEntry[];
  shortFormMentions: ShortFormMention[];
  sources: Source[];
}

export interface CreatorResearchBundle {
  query: string;
  generatedAt: string;
  profile: CreatorProfile;
  youtubeStats?: YoutubeChannelStats;
  trend?: TrendSummary;
  signals: CreatorSignalEntry[];
  shortFormMentions: ShortFormMention[];
  news: NewsEntry[];
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
