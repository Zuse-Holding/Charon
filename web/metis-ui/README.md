# Metis UI

Shared header, footer, state components, quota badge, number formatting and
design tokens for every Metis site: the hub and Intelligence (this repo),
Diligence and Committee (`committee-app`).

## Where it lives

- **Source of truth:** `Charon/web/metis-ui/`. Edit only here.
- **Copies:** `committee-app/cim-redteam/web/metis-ui/` and
  `committee-app/frontend/src/metis-ui/`. Never edit a copy.
- **Sync:** from the Charon repo root,
  `node scripts/sync-metis-ui.mjs ../committee-app/committee-app`
  copies the folder into both places and rewrites `metis-ui.lock`.
- **Check:** each repo has a test that fails if a copy's files don't match
  its `metis-ui.lock` (someone edited a copy) or, in Charon, if the source
  changed without re-running the sync. `node scripts/sync-metis-ui.mjs --check ../committee-app/committee-app`
  also reports whether committee-app is behind.

## Using it

Import `metis-ui.css` once in the app root, then the components from
`metis-ui/index.ts`. Components are plain React with `<a>` links and no
hooks, so they work in Next.js (server or client) and Vite.

- `MetisHeader`: product mark, product switcher, site links, "Sign in".
- `MetisFooter`: all three products, Privacy, Terms, Disclosures, support.
- `StateView`: loading / empty / error / partial / quota / upgrade. Required
  props: `what` happened, the `action` the person can take, and `when` it
  changes (null only if it never changes on its own).
- `QuotaBadge` / `quotaText`: "3 of 25 profiles used · resets Nov 1".
- `format.ts`: `money` ($1.19M), `multiple` (3.33x), `percent` (56%, 4.8%),
  `confidence` (0.55 -> 55%). Render numbers with `.m-num` (tabular figures).

## Rules (review checklist)

- No one-off empty, error or limit states: use `StateView`. Each repo's
  "inline state" test counts legacy ones and fails if the count grows.
- Colors, type sizes, spacing, radius and timings come from the `--m-*`
  tokens. Apps map their own variables onto them; don't add new hex values.
- Orange (`--m-accent`) is for CTAs and the brand. Product colors are for
  data only (vote pills, charts), never borders or buttons.
- Status is never color alone: always a glyph or a word with it.
- No purple or violet, no pastels.
- Sentence case for headings and buttons; buttons say what happens.
- Motion: `--m-ease` with `--m-fast` (UI) or `--m-slow` (layout), opacity
  and transform only. Reduced-motion users get none (handled here).
