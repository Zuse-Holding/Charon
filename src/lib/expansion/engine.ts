import { normalizeBusinessName, normalizePersonName } from "../entities/normalize.js";
import type { Verification } from "../provenance/findings.js";
import { MASS_THRESHOLD, isMassAgentAddress, isMassAgentName } from "./mass-agents.js";

/**
 * Related-entities expansion (Feature 4). From a target business, follow
 * public-record links out to a hop limit (default 2, hard cap 3) and
 * return them as a graph.
 *
 *   hard link   stated in a filing that carries the company's own
 *               identifier (its officers, agent and addresses). Followed.
 *   weak link   found by matching a name or an address across filings.
 *               Drawn, never followed (Feature 3: a name alone proves
 *               nothing).
 *
 * Agents and addresses that serve many unrelated companies are excluded
 * from link-building (mass-agents.ts), so a commercial registered agent
 * never pulls in its other clients. Excluded identifiers (Feature 6) are
 * never followed.
 */

export const DEFAULT_HOPS = 2;
export const MAX_HOPS = 3;

export interface RegistryRecord {
  /** Hard identifier, e.g. { issuer: "us_ny", value: "7361409" }. */
  issuer: string;
  number: string;
  name: string;
  /** Link to the record itself. */
  url: string;
  sourceName: string;
  retrievedAt: string;
  officers: { name: string; role: string }[];
  agent?: { name: string; address?: string };
  addresses: { role: string; address: string }[];
}

export type LinkKind = "officer" | "agent" | "address";

export interface RegistryProvider {
  /** Filings whose name matches the target (exact, after normalization). */
  findCompanies(name: string): Promise<RegistryRecord[]>;
  /** Other filings sharing this officer name / agent name / address, and
   *  how many share it in total (to spot mass agents). */
  sharing(kind: LinkKind, value: string, limit: number): Promise<{ records: RegistryRecord[]; total: number }>;
}

export type NodeKind = "company" | "person" | "agent" | "address";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Hops from the target. */
  hop: number;
  /** Hard identifier, companies only. */
  identifier?: string;
  url?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
  strength: "hard" | "weak";
  verification: Verification;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
}

export interface RelatedGraph {
  target: string;
  hops: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Mass agents / addresses left out of link-building. */
  excluded: string[];
  /** Officer names on too many filings to link by name at all. */
  common: string[];
  /** Links that would have been followed but were skipped (Feature 6). */
  withheld: number;
  truncated: boolean;
}

export interface ExpandOptions {
  hops?: number;
  maxNodes?: number;
  perLink?: number;
  /** Feature 6: false = don't follow this identifier. */
  mayFollow?: (kind: LinkKind, value: string) => Promise<boolean>;
}

export const clampHops = (h: number | undefined) => Math.max(1, Math.min(MAX_HOPS, Math.round(h ?? DEFAULT_HOPS)));

const companyId = (r: RegistryRecord) => `company:${r.issuer}:${r.number}`;

export async function expandRelated(target: string, provider: RegistryProvider, opts: ExpandOptions = {}): Promise<RelatedGraph> {
  const hops = clampHops(opts.hops);
  const maxNodes = opts.maxNodes ?? 80;
  const perLink = opts.perLink ?? 12;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const excluded = new Set<string>();
  const common = new Set<string>();
  let withheld = 0;
  let truncated = false;

  const addNode = (n: GraphNode): boolean => {
    const existing = nodes.get(n.id);
    if (existing) {
      existing.hop = Math.min(existing.hop, n.hop);
      return true;
    }
    if (nodes.size >= maxNodes) {
      truncated = true;
      return false;
    }
    nodes.set(n.id, n);
    return true;
  };
  const addEdge = (e: GraphEdge) => {
    const key = `${e.from}|${e.to}|${e.relation}`;
    if (e.from === e.to || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(e);
  };
  const companyNode = (r: RegistryRecord, hop: number): GraphNode =>
    ({ id: companyId(r), kind: "company", label: r.name, hop, identifier: `${r.issuer.replace(/^us_/, "").toUpperCase()} ${r.number}`, url: r.url });
  const fromRecord = (r: RegistryRecord) => ({ sourceName: r.sourceName, sourceUrl: r.url, retrievedAt: r.retrievedAt });

  // A link value shared by many filings is a mass agent or address (or,
  // for an officer, a name too common to mean anything).
  const massCache = new Map<string, { mass: boolean; others: RegistryRecord[] }>();
  async function isMass(kind: LinkKind, value: string): Promise<{ mass: boolean; others: RegistryRecord[] }> {
    if (kind === "agent" && isMassAgentName(value)) return { mass: true, others: [] };
    if (kind === "address" && isMassAgentAddress(value)) return { mass: true, others: [] };
    const key = `${kind}|${value}`;
    const cached = massCache.get(key);
    if (cached) return cached;
    const res = await provider.sharing(kind, value, perLink + 1);
    const mass = res.total > MASS_THRESHOLD;
    const out = { mass, others: mass ? [] : res.records.slice(0, perLink) };
    massCache.set(key, out);
    return out;
  }

  const targets = (await provider.findCompanies(target))
    .filter((r) => normalizeBusinessName(r.name) === normalizeBusinessName(target))
    .slice(0, 3);
  // Breadth-first over companies reached by hard links.
  let frontier: { record: RegistryRecord; hop: number }[] = [];
  for (const r of targets) {
    if (addNode(companyNode(r, 0))) frontier.push({ record: r, hop: 0 });
  }
  const expanded = new Set<string>();

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { record: r, hop } of frontier) {
      const cid = companyId(r);
      if (expanded.has(cid) || hop >= hops) continue;
      expanded.add(cid);

      // Officers: hard link from the filing; their other companies are
      // found by name only, so those are weak and not followed.
      for (const o of r.officers) {
        const pid = `person:${r.issuer}:${r.number}:${normalizePersonName(o.name)}`;
        if (!addNode({ id: pid, kind: "person", label: o.name, hop: hop + 1 })) continue;
        addEdge({ from: cid, to: pid, relation: o.role, strength: "hard", verification: "single_source", ...fromRecord(r) });
        if (hop + 2 > hops) continue;
        if (opts.mayFollow && !(await opts.mayFollow("officer", o.name))) { withheld++; continue; }
        const { mass, others } = await isMass("officer", o.name);
        if (mass) { common.add(o.name); continue; }
        for (const other of others) {
          if (companyId(other) === cid) continue;
          if (!addNode(companyNode(other, hop + 2))) break;
          addEdge({ from: pid, to: companyId(other), relation: `possible same person (name match): ${other.officers.find((x) => normalizePersonName(x.name) === normalizePersonName(o.name))?.role ?? "officer"}`,
            strength: "weak", verification: "unverified", ...fromRecord(other) });
        }
      }

      // Registered agent: excluded outright when it's a mass agent, along
      // with its office address.
      let massAgentAddress: string | undefined;
      if (r.agent?.name) {
        const { mass, others } = hop + 2 <= hops || isMassAgentName(r.agent.name)
          ? await isMass("agent", r.agent.name) : { mass: false, others: [] as RegistryRecord[] };
        if (mass) {
          excluded.add(r.agent.name);
          massAgentAddress = r.agent.address;
        } else {
          const aid = `agent:${normalizePersonName(r.agent.name)}`;
          if (addNode({ id: aid, kind: "agent", label: r.agent.name, hop: hop + 1 })) {
            addEdge({ from: cid, to: aid, relation: "registered agent", strength: "hard", verification: "single_source", ...fromRecord(r) });
            for (const other of others) {
              if (companyId(other) === cid) continue;
              if (!addNode(companyNode(other, hop + 2))) break;
              addEdge({ from: aid, to: companyId(other), relation: "same registered agent (name match)", strength: "weak", verification: "unverified", ...fromRecord(other) });
            }
          }
        }
      }

      // Addresses: a place links filings, never merges them. Weak.
      for (const a of r.addresses) {
        if (excluded.has(a.address)) continue;
        if (massAgentAddress && a.address === massAgentAddress) { excluded.add(a.address); continue; }
        const { mass, others } = hop + 2 <= hops || isMassAgentAddress(a.address)
          ? await isMass("address", a.address) : { mass: false, others: [] as RegistryRecord[] };
        if (mass) { excluded.add(a.address); continue; }
        const adid = `address:${a.address}`;
        if (!addNode({ id: adid, kind: "address", label: a.address, hop: hop + 1 })) continue;
        addEdge({ from: cid, to: adid, relation: `${a.role} address`, strength: "hard", verification: "single_source", ...fromRecord(r) });
        for (const other of others) {
          if (companyId(other) === cid) continue;
          if (!addNode(companyNode(other, hop + 2))) break;
          addEdge({ from: adid, to: companyId(other), relation: `shares ${other.addresses.find((x) => x.address === a.address)?.role ?? ""} address`.replace(/\s+/g, " "),
            strength: "weak", verification: "unverified", ...fromRecord(other) });
        }
      }
      // No hard company-to-company links in this source yet; a provider
      // that has them (e.g. a corporate officer with its own entity
      // number) adds to `next` here and the hop limit applies.
    }
    frontier = next;
  }

  return { target, hops, nodes: [...nodes.values()], edges, excluded: [...excluded], common: [...common], withheld, truncated };
}
