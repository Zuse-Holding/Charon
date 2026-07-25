# Next Verticals — Scoping (not yet built)

Scoped for later build. Nothing in this doc has been started. Written against
the current agent architecture (search-and-synthesize agents dispatched by
the orchestrator, tier-gated in `server/agent-server.ts`, rendered by
`ReportAgent`) so estimates reflect what fits that pattern cleanly vs. what
doesn't.

---

## 1. Creator / Market Signal Intelligence
Consumer & audience trend tracking — creators, brands, sentiment, growth signals.

> **Correction — there's already a TikTok creator-intelligence agent in the
> codebase** (`src/agents/creator-agent/index.ts`, "Charon Protocol — Sprint
> 1"). Important to be clear about what it actually is before assuming it
> covers this roadmap item: it's a bespoke tool built for one client vertical
> (health/pharma — hardcoded to GLP-1/weight-loss hashtags, scores creators
> in a follower "sweet spot," flags FTC-style paid-disclosure language —
> reads like influencer-marketing compliance monitoring for that specific
> use case, not general market research). It pulls from a paid RapidAPI
> TikTok-scraper endpoint (not free, and unofficial — real ToS exposure
> since it's not TikTok's own API), and it's **not wired into the
> orchestrator, agent-server, or any UI** — it only runs standalone via CLI
> and writes to a `creators` Supabase table nothing else reads. So: proof
> the hashtag-scan approach works, but not a starting point for a general,
> multi-industry creator/market-signal product — that's still a separate
> build. Worth deciding whether the roadmapped version generalizes this tool
> or is scoped fresh.

### Data sources (ranked by reliability)
- **YouTube Data API** — free, official, structured (subscriber count, view
  counts, upload cadence). The one genuinely authoritative source here.
- **Google Trends** — free, search-interest-over-time. Good for "is this
  rising or falling" on a brand/topic/person, no account-level data.
- **News/sentiment** — reuse the existing `NewsAgent` pattern directly for
  controversy and coverage tracking.
- **TikTok / Instagram / X follower & engagement stats** — no reliable free
  API for arbitrary accounts. Options are scraping (fragile, ToS risk) or a
  paid aggregator (Social Blade, HypeAuditor, Modash all charge). If included
  at all in v1, treat as search-derived and flag it that way in the report —
  same "don't fabricate" discipline as everything else, not a "trust this
  number" field.

### Recommended v1 scope
New `creator-agent`, same shape as `political-agent`: search-synthesis for
narrative/bio/controversy, YouTube API as the one hard-numbers source where
applicable, Google Trends for the trend line. Everything else stays
qualitative/sourced-but-unverified, explicitly labeled as such.

### Stack changes needed (same pattern used for political research)
- `CreatorResearchBundle` type in `types/research.ts`
- New agent + orchestrator dispatch method (`researchCreator`)
- New `ReportAgent.generateCreator()` template
- New entity-type option in the web research form + Sidebar/Dashboard icon
- New CLI command, new agent-server route
- Tier placement: recommend gating above `basic` initially (`pro`+) given
  data quality is inherently softer than the company/person pipelines —
  revisit once real output quality is validated.

### Open question
Is "market signal" here about individual creators, or broader consumer/brand
trend tracking (e.g., "is X product category trending")? Changes which
queries and which of the above sources actually matter most. Worth pinning
down before build starts.

---

## 2. Local Market Intelligence
Business license/permit data — aimed at CRE brokers and franchise site scouts.

**Status (7/24): someday, not started.** The scoping below still holds; a
full implementation plan (architecture, data-source specifics, build order,
open questions) is written up and ready in
[`local-market-intel-plan.md`](./local-market-intel-plan.md) for whenever
this gets greenlit — no need to re-derive it from scratch at that point.

**This one is architecturally different from everything else in the
platform**, worth flagging up front: every existing agent answers "tell me
about this named entity." This vertical answers "what's happening in this
geography" — a location + business-type query, not a name search. It doesn't
fit the current orchestrator dispatch pattern (name → agents → bundle) and
would need its own query shape and likely its own UI search mode, not just a
new result type on the existing form.

### Data sources
- **No single national API exists.** This is the core problem with this
  vertical.
- **Municipal open-data portals** (Socrata-based: NYC Open Data, LA, SF,
  Chicago, etc.) — free, structured, but each city has its own schema and
  endpoint. Real coverage means integrating metro-by-metro, not once.
- **Census Bureau Business Formation Statistics** — free, national, but
  county/state-level aggregate counts only. Good for macro trend context
  ("business formation up 8% in this county"), useless for a specific-address
  lookup.
- **State Secretary of State business registrations** — varies wildly by
  state; some free bulk downloads, some paid, no consistent schema.
- **The tools CRE brokers already use** (CoStar, Placer.ai, SafeGraph, Yardi
  Matrix) are expensive commercial contracts, not APIs we could quietly wire
  in as a feature.

### Recommended v1 scope
Pilot with 2–3 metros that have clean Socrata endpoints (NYC, LA, Chicago are
good candidates), layer in Census BFS for macro trend framing. Explicitly
scope this as "a few metros, expanding over time" rather than promising
national coverage out of the gate — the honest constraint is data
availability, not engineering effort.

### Stack changes needed
- New query shape: location + business-type/category, not entity name
- New agent(s) per data source type (open-data query agent, Census BFS agent)
- Likely a new UI search mode (not the existing name-search box)
- New bundle type, report template, tier placement (probably a distinct
  product tier given the different buyer — CRE brokers/franchise scouts, not
  the existing LP/investor-research audience)

### Honest assessment
This is the heaviest lift of the three items in this doc, and the most
different from what's already built. Worth a explicit go/no-go conversation
before starting, since it's as much a data-partnerships/scope question as an
engineering one.

---

## 3. Advanced Research Tooling (reserved for top internal tier)

Status check against what's actually live today — two of the four items in
the partner-update bullet are **already built and shipped**, not just scoped:

| Item | Status |
|---|---|
| FOIA-based document search | **Already live.** `MuckRockAgent`, Charon-tier deep mode, wired into both person and political research. |
| Corporate registries cross-referencing | **Already live.** `OpenCorporatesAgent` (officer/directorship records across jurisdictions), Charon-tier deep mode, wired into person research. |
| FEC / campaign finance cross-referencing | **Partially live.** `OpenFecAgent` exists and is wired into political research, but not into person research — i.e., searching a private individual doesn't currently check whether they're a political donor. Small addition: one more call site in `researchPerson`, agent already built. |
| Court records | **Not built.** No PACER/CourtListener integration exists. This is the one genuinely unscoped item — flagged earlier this session for "later," never started. PACER is paid/per-page and login-gated; CourtListener/RECAP (free, better fit) is the likelier choice. |

### What's actually left to scope here
- **Court records (CourtListener/RECAP)** — real build, not yet scoped in
  detail. Needs its own pass: API shape, rate limits, what counts as a
  meaningful hit for a person search.
- **Insider-trading filings for person search** — Form 4 data already exists
  at the company level (`corporateAgent.insiderActivity`), but isn't
  surfaced when searching a *person* directly. Needs the query flipped
  (person name → their filings across companies) rather than the current
  company → officers direction, which likely means a different SEC EDGAR
  full-text search query, not just reusing the existing call.

Recommend correcting the partner-update language on FOIA search and
corporate-registry cross-referencing since those are done, not upcoming —
worth not underselling what's already shipped to LPs.
