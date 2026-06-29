# SELINE INTEL — Sprint 1

AI-powered business intelligence research CLI. Sprint 1 scope per roadmap:
Research Orchestrator + Website Agent + News Agent (search-fallback) + Report Generator.

## Setup

    npm install
    cp .env.example .env   # optional: add SERPER_API_KEY for search fallback

## Usage

    npm run research -- "Hims & Hers"

Writes `reports/<slug>.md`.

## Architecture

    src/
      agents/
        orchestrator/   # coordinates agents, builds ResearchBundle
        website-agent/   # site discovery + heuristic extraction
        news-agent/       # search-based news collection
        report-agent/     # ResearchBundle -> markdown
      lib/
        providers.ts       # FetchProvider / SearchProvider abstraction
      types/
        research.ts         # shared data models (Source, CompanyProfile, etc.)
      cli.ts                  # commander entrypoint

## Sourcing strategy

Each agent goes through `resolveAndFetch()`: try a direct URL guess first,
fall back to web search (Serper.dev) if that fails or no key is set. No key
-> degraded mode (direct fetch only), not a crash. This keeps agent logic
decoupled from the provider, so swapping in a different search API or an
LLM-based extractor later doesn't touch agent code.

## Known Sprint 1 limitations (by design, not bugs)

- Website Agent extraction is heuristic (first-N-chars description), not
  LLM-parsed. Output shape is stable so this is a drop-in upgrade later.
- No Leadership/Funding extraction yet — needs structured parsing, planned
  for a later sprint.
- Risks/Opportunities sections are placeholders — that's analytical
  synthesis, not raw collection, and is intentionally out of scope here.
- Agents run sequentially, not in parallel (debuggability over speed for
  Sprint 1).

## Roadmap

See project spec — Sprint 2 adds Corporate Agent + citation engine,
Sprint 3 adds Supabase persistence, Sprint 4 the Next.js dashboard.
