import { PowerMapEntry, Source } from "../../types/research.js";

/**
 * LittleSis Agent (7/20 public-record fusion, roadmap #3 — the
 * cross-entity resolution layer) — searches LittleSis's power-mapping
 * database (people/orgs/boards, run by the Public Accountability
 * Initiative) for a name. No API key required. Relevant to both company
 * and person research, same as ProPublica Nonprofit — LittleSis indexes
 * both entity kinds under one search.
 *
 * This surfaces *candidate* matches (LittleSis's own entity records),
 * not the full relationship graph behind each one — pulling every
 * relationship for every match would be a much heavier, slower call.
 * The report links out to the LittleSis entity page itself for anyone
 * who wants to actually explore the power-map from there.
 */

const LITTLESIS_BASE = "https://littlesis.org/api";

interface LittleSisEntityAttributes {
  id: number;
  name: string;
  blurb?: string;
  primary_ext?: string; // "Person" | "Org"
}

interface LittleSisEntity {
  type: string;
  id: number;
  attributes: LittleSisEntityAttributes;
}

interface LittleSisSearchResponse {
  data?: LittleSisEntity[];
}

export class LittleSisAgent {
  async run(name: string): Promise<{ matches: PowerMapEntry[]; sources: Source[] }> {
    try {
      const res = await fetch(
        `${LITTLESIS_BASE}/entities/search?q=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[littlesis-agent] "${name}" — HTTP ${res.status}`);
        return { matches: [], sources: [] };
      }

      const data = (await res.json()) as LittleSisSearchResponse;
      const results = data.data ?? [];

      const matches: PowerMapEntry[] = results
        .filter((r) => r.attributes?.name)
        .slice(0, 8)
        .map((r) => ({
          name: r.attributes.name,
          entityKind: r.attributes.primary_ext,
          blurb: r.attributes.blurb,
          url: `https://littlesis.org/entities/${r.attributes.id}`,
        }));

      const sources: Source[] = matches.length > 0
        ? [{
            url: `https://littlesis.org/search?q=${encodeURIComponent(name)}`,
            title: `LittleSis power-map search — ${name}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["power-map"],
          }]
        : [];

      console.log(`[littlesis-agent] "${name}" — ${matches.length} match(es)`);

      return { matches, sources };
    } catch (err) {
      console.warn(`[littlesis-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { matches: [], sources: [] };
    }
  }
}
