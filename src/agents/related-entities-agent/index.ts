import type { Source } from "../../types/research.js";
import { expandRelated, type ExpandOptions, type RegistryProvider, type RelatedGraph } from "../../lib/expansion/engine.js";
import { NyDosProvider } from "./ny-dos.js";

/**
 * Related entities (Feature 4) for company research: the target's other
 * companies, shared officers, agents and addresses, from public filings.
 * Source today: New York Department of State filings (free). Other states
 * plug in as further RegistryProviders.
 */
export class RelatedEntitiesAgent {
  constructor(private provider: RegistryProvider = new NyDosProvider()) {}

  async run(companyName: string, opts: ExpandOptions = {}): Promise<{ graph?: RelatedGraph; sources: Source[] }> {
    const graph = await expandRelated(companyName, this.provider, opts);
    if (graph.nodes.length === 0) return { sources: [] };
    const retrievedAt = new Date().toISOString();
    const sources: Source[] = [...new Map(graph.edges.map((e) => [e.sourceUrl, e])).values()]
      .slice(0, 20)
      .map((e) => ({ url: e.sourceUrl, title: e.sourceName, retrievedAt, usedFor: ["related-entities"] }));
    return { graph, sources };
  }
}
