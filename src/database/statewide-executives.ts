import { createClient } from "@supabase/supabase-js";

/**
 * Statewide Executives lookup (political research fix #2) — a small,
 * hand-seeded reference table for offices Congress.gov and OpenFEC don't
 * cover at all (both are federal-only): governor, lieutenant governor,
 * attorney general, secretary of state, treasurer.
 *
 * Scope note: seeded with all 50 governors only for this pass — sourced
 * live from Ballotpedia's current-governors list (not from memory), see
 * supabase/statewide_executives_seed.sql. Lieutenant governor/AG/SoS/
 * treasurer (~200 more rows) are a deliberate fast-follow, not built here
 * — verifying 250 officeholders accurately in one pass isn't something to
 * rush, especially for a table whose whole purpose is being an
 * authoritative source. The table/lookup code below already supports all
 * five office types; only the seed data is scoped down for now.
 *
 * Same client pattern as knowledge-graph.ts — service-role key, so this
 * bypasses RLS and is safe to call from server-side agent code only.
 */

const STATEWIDE_OFFICES = [
  "governor",
  "lieutenant_governor",
  "attorney_general",
  "secretary_of_state",
  "treasurer",
] as const;

export type StatewideOffice = (typeof STATEWIDE_OFFICES)[number];

export interface StatewideExecutiveRecord {
  state: string; // USPS 2-letter code
  office: StatewideOffice;
  name: string;
  party?: string;
  termStart?: string;
  sourceUrl?: string;
}

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null; // fail closed, not throw — this is a nice-to-have source, not a hard dependency
  return createClient(url, key);
}

const OFFICE_LABEL: Record<StatewideOffice, string> = {
  governor: "Governor",
  lieutenant_governor: "Lieutenant Governor",
  attorney_general: "Attorney General",
  secretary_of_state: "Secretary of State",
  treasurer: "Treasurer",
};

/**
 * Fuzzy name match against the whole table — cheap since this table is at
 * most 250 rows, no need for a dedicated search index.
 */
export async function lookupStatewideExecutive(name: string): Promise<{
  found: boolean;
  office?: string;
  party?: string;
  state?: string;
  termStart?: string;
  sourceUrl?: string;
}> {
  const client = getClient();
  if (!client) return { found: false };

  try {
    const { data, error } = await client.from("statewide_executives").select("*");
    if (error || !data) {
      console.warn("[statewide-executives] lookup query failed:", error ? JSON.stringify(error) : "no data");
      return { found: false };
    }

    const needle = name.toLowerCase().trim();
    const match = (data as Array<Record<string, unknown>>).find((row) => {
      const rowName = String(row.name ?? "").toLowerCase();
      return rowName === needle || rowName.includes(needle) || needle.includes(rowName);
    });

    if (!match) return { found: false };

    const office = match.office as StatewideOffice;
    console.log(`[statewide-executives] "${name}" — matched ${OFFICE_LABEL[office] ?? office} of ${match.state}`);

    return {
      found: true,
      office: OFFICE_LABEL[office] ?? String(office),
      party: match.party as string | undefined,
      state: match.state as string | undefined,
      termStart: match.term_start as string | undefined,
      sourceUrl: match.source_url as string | undefined,
    };
  } catch (err) {
    console.warn("[statewide-executives] lookup failed:", err instanceof Error ? err.message : err);
    return { found: false };
  }
}
