# Changelog

## Unreleased

### Related-entities expansion (Feature 4): behind `FEATURE_RELATED_ENTITIES`
- Company reports gain a "Related Entities" section: a graph (with a table view and CSV export) of the target's officers, registered agent and addresses from its own filing, and the other companies that share them.
- Links stated in the target's filing are hard; other companies found by officer name, agent name or address are weak: drawn dashed, labeled as a name or address match, and never followed. Hop limit 2 by default, configurable per search (`relatedHops` on the research request), capped at 3.
- Mass registered agents and their office addresses are excluded from link-building (a maintained list in `src/lib/expansion/mass-agents.ts`, plus any agent or address shared by more than 25 filings), so a commercial agent never pulls in its other clients. Officer names on more than 25 filings are too common to link.
- Every edge carries its source filing, retrieval date and verification (Feature 2); identifiers on the self-exclusion list (Feature 6) are never followed.
- Source today: New York Department of State filings via the state's open data portal (free; `NY_OPEN_DATA_APP_TOKEN` optional). OpenCorporates (needs a paid API token) and SEC EDGAR (blocked from the build machine) were checked and not used yet; other states plug in as further providers.
- Setup: set `FEATURE_RELATED_ENTITIES=on` on the agent server, after Feature 6 is on for users. No database change.

### Self-exclusion list (Feature 6): behind `FEATURE_SELF_EXCLUSION`
- Subscribers add their own email, phone number, or name with date of birth at Settings → Self-exclusion (`/settings/self-exclusion`). An entry takes effect only after an ownership check: email by a confirmation link sent to that address, phone by an SMS code (Twilio Verify), name and date of birth by the owner's statement plus a link sent to their account email.
- Limits: 5 entries for individual plans, 25 for Team. Removal is one click and immediate. Unconfirmed entries expire after 24 hours; codes lock after 5 wrong tries.
- Identifiers are stored only as HMAC-SHA256 with a server-side key, plus a masked hint (e.g. `j•••@g•••`). The table has no browser access at all.
- A search that names an excluded email, phone number, or name with date of birth (research, Charon person lookup, MuckRock search, deep dive) returns a neutral "This search isn't available." before anything is counted or logged. `ExclusionGuard.followable()` is the hook Feature 4's expansion must use to skip excluded identifiers.
- Setup, in this order: run the self-exclusion block at the end of `supabase/schema.sql`; on the agent server set `EXCLUSION_HASH_KEY` (once, 32+ random characters), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and confirm `FRONTEND_URL` and `RESEND_API_KEY` are set; then `FEATURE_SELF_EXCLUSION=on` (agent server) and `NEXT_PUBLIC_FEATURE_SELF_EXCLUSION=on` (web).

### Passive domain posture check (Feature 5): behind `FEATURE_DOMAIN_POSTURE`
- Company reports gain a "Domain Posture" card for the company's website domain, built from public records only: the registry's RDAP record (found through IANA's bootstrap file), public DNS over HTTPS, and the certificate from one ordinary HTTPS handshake. No scanning or probing.
- Flags: expiry within 90 days, registered to an individual, no transfer lock, SPF missing or ending in +all, DMARC missing or p=none, no CAA (low), certificate expiring within 30 days. Each flag carries a plain-English line on why it matters to a buyer. A privacy-protected registrant is reported as "registrant hidden", not flagged; a failed lookup is "unknown", never a flag.
- Feeds the coverage ledger (as "Domain records") and provenance: each check is a finding linked to the stored registry or DNS response it was read from.
- Setup: set `FEATURE_DOMAIN_POSTURE=on` on the agent server. No keys, no database change.

### Identifier-based entity resolution (Feature 3): behind `FEATURE_ENTITY_RESOLUTION`
- Knowledge Graph entities merge only when they share a hard identifier: an EIN (from ProPublica nonprofit filings) or a state entity number together with its state (from OpenCorporates company links). Each identifier is stored with the source that supplied it.
- A shared name alone never merges. The new entity is flagged as a possible match, with "Merge them" and "Keep separate" buttons; each decision is logged with who made it and when (`kg_match_reviews`).
- Same name with different entity numbers from the same state stays separate and is labeled distinct. The database refuses to merge them even if asked. Same-named companies from different states are flagged for review, since one company can be registered in several states.
- Business names are normalized for matching (legal suffixes, punctuation and case removed) but never used as a merge key.
- Setup, in this order: deploy this code; run the entity resolution block at the end of `supabase/schema.sql` (running it before the deploy breaks graph writes, because the old code relies on the constraint it drops); then set `FEATURE_ENTITY_RESOLUTION=on` (agent server) and `NEXT_PUBLIC_FEATURE_ENTITY_RESOLUTION=on` (web). The block drops the old one-entity-per-name constraint; with the flag off, the graph still dedupes by name in code, exactly as before.

### Source coverage ledger (Feature 1): behind `FEATURE_COVERAGE`
- Company and person reports list every source for that report type with one of four statuses: results (with a count and the section they're in), no matches (with the query used), not searched (with the reason and a link to search by hand), or error.
- A source registry (`src/lib/coverage/registry.ts`) records each source's name, jurisdiction, category, access method and deep-link template. Sources that can't be automated (PACER, California and Delaware business searches, California UCC liens, CourtListener for now) are always listed.
- Errors are never shown as "no matches": a timeout (90s per source), a thrown error, a failed request (5xx, 429 or network error) with nothing returned, or a missing API key all show as Error. When a source fails, the report offers to run it again.
- A one-line summary sits under the executive summary, e.g. "5 of 14 sources searched; 9 require manual check."
- Setup: set `FEATURE_COVERAGE=on` on the agent server. No web flag is needed: the table appears in any report that has the section.

### Provenance on every finding (Feature 2): behind `FEATURE_PROVENANCE`
- Research runs record the raw response of every source fetch (not LLM, database or analytics traffic), hash it with SHA-256 and store it in the private `snapshots` bucket.
- Each claim in a report becomes a finding with a source URL, retrieval time, retrieval method, snapshot hash and a verification state: confirmed (two or more independent sites), single source, or unverified. An unverified finding is shown, never dropped.
- Findings without a source URL or a retrieval time fail validation (zod) and are rejected by the database (`NOT NULL` and `CHECK` constraints).
- Reports gain a "Findings and Sources" section: a table with status badges and a CSV export, which stacks into cards on phones. When `NEXT_PUBLIC_FEATURE_PROVENANCE` is on, older reports show a notice that they predate per-finding sources.
- Deleting a run removes its findings, snapshot rows and stored responses.
- Setup: run the provenance block at the end of `supabase/schema.sql`, then set `FEATURE_PROVENANCE=on` (agent server) and `NEXT_PUBLIC_FEATURE_PROVENANCE=on` (web).

### Scope and compliance
- Removed ICIJ Offshore Leaks lookups and photo identity verification (face matching). Run the `DROP TABLE IF EXISTS identity_verification_audit;` line in `supabase/schema.sql`.
- Every report ends with a disclaimer: Metis is not a consumer reporting agency, and reports must not be used for employment, credit, housing or insurance decisions.
- Added feature flags (`src/lib/flags.ts`, `web/lib/flags.ts`), a test runner (`npm test`) and CI (typecheck and tests on every push and pull request).
