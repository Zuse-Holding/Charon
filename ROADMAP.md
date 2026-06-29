# SELINE INTEL — Roadmap

## Current State (v0.1 — June 2026)
**Status: Demo-ready**

### Working
- Multi-agent research pipeline — Company, Person, Product
- Agents: Website, News, Competitor, Corporate, People, Product, Synthesis
- LLM extraction: Groq (primary, free tier) → Ollama (fallback) → Heuristics (fallback)
- Local persistence: `database/store.json`
- CLI: `research`, `research-person`, `research-product`, `list`, `show`, `watch`, `watchlist`, `watchlist-refresh`
- Next.js dashboard: Dashboard, Reports, Watchlist, Knowledge Graph (placeholder), Settings
- Remote access: ngrok tunnel
- Mobile responsive layout

### Known Gaps
- Executive Summary sometimes picks up nav-menu text (JS-rendered sites)
- Founded / Industry fields often Unknown (snippet-only extraction limitation)
- Competitors list is thin without LLM (only catches names in clean listicles)
- Funding data sometimes mismatched (Tracxn table-dump noise)
- Source citations are page-level, not claim-level

---

## Tomorrow (June 25)

### Must Do
- [ ] **GitHub setup** — create repo under Zuse Holdings, push with proper .gitignore
- [ ] **`next build` production mode** — dramatically faster than dev for demos
- [ ] **Test Watchlist end-to-end** — refresh button, staleness reset, re-verify
- [ ] **Test on phone** — layout check, fix anything broken on mobile

### Should Do
- [ ] **Contextual ticker** — Watchlist news feed showing headlines for watched entities
- [ ] **Add to Watchlist from UI** — button in report header, no CLI needed
- [ ] **Search loading progress** — multi-step status ("Searching... Analyzing... Writing...")

---

## Week 2 (Quality)
- [ ] **Full page fetching** — read full article text instead of 2-line snippets (biggest quality jump)
- [ ] **Source citation engine** — tie specific claims to specific sources
- [ ] **Founded / Industry extraction** — dedicated search + LLM pass for these fields
- [ ] **Competitor deduplication** — merge "PayPal" and "paypal.com" as one entity

---

## Month 2 (Data Depth)
- [ ] **Crunchbase free tier** — real funding data
- [ ] **SEC EDGAR integration** — filings for public companies (free, no API key)
- [ ] **LinkedIn public profile scraping** — leadership career history
- [ ] **Supabase migration** — move off local JSON, enable cloud sync

---

## Month 3 (Intelligence Layer)
- [ ] **Knowledge Graph v1** — store entity relationships in graph structure
- [ ] **Multi-step research** — orchestrator follows up on what it finds
- [ ] **Diff engine** — "what changed since last week" for Watchlist entries
- [ ] **Report comparison** — compare two companies side by side

---

## Month 4 (Platform)
- [ ] **PDF export** — report → polished PDF for sharing
- [ ] **SELINE Venture agent** — "research all telehealth competitors in West LA"
- [ ] **API endpoints** — other tools can query SELINE programmatically
- [ ] **Knowledge Graph visualization** — interactive node-link diagram

---

## Month 5–6 (Launch Prep)
- [ ] **Vercel deployment** with password protection
- [ ] **Pricing model** — research comparable tools, set tiers
- [ ] **Pitch deck** — built around real SELINE output (show don't tell)
- [ ] **First paying customer** — target: founder, operator, or BD person
