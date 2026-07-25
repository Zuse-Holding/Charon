# Local Market Intelligence — Implementation Plan (someday, not started)

Status: **someday**. Not scheduled, not started, no code written. This is the
build blueprint to execute *when* the go/no-go call in
[`next-verticals-scoping.md`](./next-verticals-scoping.md) (item #2) gets
made — pricing/tier placement and the "is CRE brokers/franchise scouts the
right buyer" question are still open and belong to that conversation, not
this doc. This doc only answers "how would we actually build it."

---

## 1. Why this doesn't fit the existing pattern

Every other vertical in this platform (company, person, product, political,
creator) answers **"tell me about this named thing"** — a name goes in, an
orchestrator dispatches agents, a bundle comes out, one report template
renders it. Local Market Intelligence answers **"what's happening in this
location"** — a location + optional business-type/date-range query, no name
involved. That means:

- No entity name to key a report/watchlist/knowledge-graph entry on — needs
  its own identity shape (e.g. `{metro, businessType, dateRange}` as the
  "subject," not a string name).
- Doesn't hang off `ResearchOrchestrator`'s `research<Type>(name)` method
  shape — needs its own dispatch method with a different signature, or
  arguably its own orchestrator-adjacent module rather than a method bolted
  onto the existing one.
- Doesn't fit the Topbar's single text-input + entity-type-pill UI — needs a
  **separate search surface** (location picker + category input), not a
  sixth pill.

Keep this front-of-mind: the temptation will be to wedge it into the
existing name-search flow for speed. Don't — it'll produce a confusing UI
("search a company... or a city?") and a data model that fights the report
templates for every other type.

---

## 2. Data sources — what's actually free and what it covers

| Source | Coverage | Cost | Grain |
|---|---|---|---|
| Socrata municipal open-data portals | NYC, LA, Chicago (v1 pilot set) | Free — self-serve App Token per portal, no approval wait | Address-level: individual business licenses/permits |
| Census Bureau Business Formation Statistics (BFS) | National | Free — self-serve API key (`api.census.gov/data/key_signup.html`) | County/state aggregate only — "formations up X% in this county," not address-level |
| State Secretary of State registrations | Varies by state | Inconsistent — some free bulk downloads, some paid, no shared schema | **Out of v1 scope entirely** — revisit only if a specific state becomes a priority |
| CoStar / Placer.ai / SafeGraph / Yardi Matrix | National, what CRE brokers already pay for | Expensive commercial contracts | N/A — not something to quietly wire in; if we ever license one of these it's a business deal, not an API key in `.env.example` |

**No single national API exists — that's the permanent constraint, not a gap
to eventually close.** Coverage means integrating metro-by-metro. Ship "NYC,
LA, Chicago, expanding over time" honestly rather than implying broader
coverage.

Before wiring anything: **verify current dataset IDs and field schemas
against the live Socrata portals** — dataset IDs on data.cityofnewyork.us /
data.lacity.org / data.cityofchicago.org are not guaranteed stable, and
nothing here should be trusted as current without checking at build time.
Same for the Census BFS API's current endpoint shape.

---

## 3. Proposed architecture

### Types (`src/types/research.ts`)

```ts
export interface LocalMarketQuery {
  metro: "nyc" | "la" | "chicago"; // v1 — closed set, not freeform
  businessType?: string;            // e.g. "restaurant", "retail"
  dateRange?: { from: string; to: string }; // ISO dates
}

export interface BusinessLicenseEntry {
  name: string;
  address: string;
  licenseType?: string;
  issueDate?: string;
  status?: string;       // "active" | "pending" | "expired" | source-specific
  sourceUrl: string;
}

export interface FormationTrendPoint {
  period: string;   // e.g. "2026-Q2"
  applications: number;
  yoyChangePct?: number;
}

export interface LocalMarketBundle {
  query: LocalMarketQuery;
  generatedAt: string;
  listings: BusinessLicenseEntry[];
  formationTrend?: FormationTrendPoint[]; // county/state-level, from Census BFS
  coverageNote: string; // always present — explicit "NYC/LA/Chicago only" disclaimer
  sources: Source[];
}
```

### Agents (`src/agents/`)

- **`socrata-agent`** — one parameterized client, not three duplicated
  agents. Takes a per-metro config object (`{domain, datasetId, fieldMap}`)
  and speaks SoQL (Socrata's query language) to filter by date range and
  category. Adding a fourth metro later means adding a config entry, not a
  new agent class.
- **`census-bfs-agent`** — separate agent, resolves the query's metro to a
  county/state FIPS code, pulls formation-trend data. Runs alongside
  `socrata-agent`, not dependent on it.
- No `local-market-agent` orchestrator wrapper needed at the
  `ResearchOrchestrator` level necessarily — this could be its own small
  module (`src/agents/local-market/index.ts`) with a
  `runLocalMarketQuery(query: LocalMarketQuery)` function, called directly
  from a dedicated API route rather than threaded through
  `ResearchOrchestrator`'s existing `research<Type>(name)` method shape,
  since the input shape is fundamentally different. Revisit this call if it
  turns out to want the same news/synthesis agents company research uses.

### Report template (`src/agents/report-agent/index.ts`)

- `generateLocalMarket(bundle: LocalMarketBundle)` — table/list of listings
  (name, address, type, issue date, status, link), a macro-trend section
  from Census BFS framed as county/state context (explicitly not
  address-level), and the coverage disclaimer up top, not buried in Sources.

### UI

- **New search surface, not a Topbar pill.** A dedicated page
  (`/app/local` or similar) with:
  - Metro selector — **dropdown of the 2-3 supported metros, not freeform
    text** — v1 only supports a closed set, and a freeform box that silently
    fails for "Denver" is worse than a dropdown that's honest about
    coverage upfront.
  - Business-type input (optional, freeform or a short curated list).
  - Optional date range.
- New icon/nav entry in `Sidebar.tsx` pointing at this page.

### Tier placement

**Not decided — business/pricing call, not an engineering one.** Likely its
own tier or add-on given the buyer (CRE brokers/franchise scouts) doesn't
overlap with the existing LP/investor-research audience. Don't default this
to any existing tier's access list without that conversation happening
first.

---

## 4. Build order, when this gets greenlit

1. **One metro, end to end** — pick Chicago (or whichever has the cleanest
   current Socrata docs at build time) and build `socrata-agent` config +
   `census-bfs-agent` + `LocalMarketBundle` + report template + a bare-bones
   UI, before generalizing. Prove the pattern once, cheaply.
2. **Add NYC + LA** as additional `socrata-agent` config entries.
3. **Real UI** — metro dropdown, category input, date range, nav entry.
4. **Tier/pricing decision**, made with the business side, before this goes
   out beyond internal testing.

## 5. Open questions to pin down before step 1 starts

- Current Socrata dataset IDs + field schemas for NYC/LA/Chicago (verify
  live, don't trust anything pre-written here or recalled from memory).
- Current Census BFS API endpoint shape and key signup flow.
- Whether "business type" filtering should be a curated dropdown (cleaner
  SoQL queries, consistent categories across metros) or freeform text
  (more flexible, messier to normalize across three different schemas).
- Tier/pricing placement (business call).
- Whether this ever needs `NewsAgent`/synthesis-style enrichment, or stays
  pure structured-data — leaning toward the latter for v1 given the
  audience wants filterable listings, not narrative.
