import type { PersonResearchBundle, ResearchBundle } from "../../types/research.js";
import { canonicalIdentifier, type EntityCandidate, type Identifier } from "./resolve.js";

/**
 * Records in a research bundle that carry a hard identifier (Feature 3).
 * Each one becomes its own Knowledge Graph entity, keyed by identifier.
 *
 *   EIN                 ProPublica Nonprofit Explorer filings
 *   state entity number OpenCorporates company links (/companies/us_de/123)
 */

export interface IdentifiedRecord extends EntityCandidate {
  /** How the research subject relates to the record, if it says. */
  relationship?: string;
}

const OPENCORPORATES_COMPANY = /^https?:\/\/(?:www\.)?opencorporates\.com\/companies\/([a-z]{2}(?:_[a-z0-9]{2,})?)\/([^/?#]+)/i;

/** The jurisdiction and entity number in an OpenCorporates company URL. */
export function parseOpenCorporatesUrl(url: string | undefined): { issuer: string; value: string } | undefined {
  const m = url?.match(OPENCORPORATES_COMPANY);
  return m ? { issuer: m[1].toLowerCase(), value: decodeURIComponent(m[2]) } : undefined;
}

function record(name: string, raw: Identifier, relationship?: string): IdentifiedRecord | undefined {
  const id = canonicalIdentifier(raw);
  return id ? { name, type: "company", identifiers: [id], relationship } : undefined;
}

export function recordsFromBundle(bundle: Partial<ResearchBundle & PersonResearchBundle>): IdentifiedRecord[] {
  const at = bundle.generatedAt ?? new Date().toISOString();
  const out: (IdentifiedRecord | undefined)[] = [];

  for (const n of bundle.nonprofitFilings ?? []) {
    out.push(record(n.name, {
      kind: "ein", issuer: "", value: n.ein,
      sourceName: "ProPublica Nonprofit Explorer", sourceUrl: n.url, retrievedAt: at,
    }));
  }
  for (const a of bundle.corporateAffiliations ?? []) {
    const oc = parseOpenCorporatesUrl(a.companyUrl);
    if (!oc) continue;
    out.push(record(a.companyName, {
      kind: "state_entity_number", issuer: oc.issuer, value: oc.value,
      sourceName: "OpenCorporates", sourceUrl: a.companyUrl!, retrievedAt: at,
    }, a.position ? a.position.toUpperCase() : "AFFILIATED_WITH"));
  }
  return out.filter((r): r is IdentifiedRecord => r !== undefined);
}
