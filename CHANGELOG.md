# Changelog

## Unreleased

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
