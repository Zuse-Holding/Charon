import type { LinkKind, RegistryProvider, RegistryRecord } from "../../lib/expansion/engine.js";
import { normalizeAddress } from "../../lib/expansion/mass-agents.js";

/**
 * New York Department of State corporation filings, from the state's open
 * data portal ("Active Corporations: Beginning 1800", Socrata dataset
 * n9v6-gdp6). Free, no key; NY_OPEN_DATA_APP_TOKEN raises the rate limit.
 *
 * Per filing: DOS ID (the hard identifier), chairman/CEO, registered
 * agent, service-of-process address and principal office address.
 */

const DATASET = "https://data.ny.gov/resource/n9v6-gdp6.json";
const SOURCE_NAME = "New York Department of State filing";

type Row = Record<string, string | undefined>;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class NyDosProvider implements RegistryProvider {
  /** normalized address -> the raw street line and ZIP to query by */
  private rawAddress = new Map<string, { street: string; zip?: string }>();

  constructor(private env: Record<string, string | undefined> = process.env) {}

  private async query(params: Record<string, string>): Promise<Row[]> {
    const url = `${DATASET}?${new URLSearchParams(params)}`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.env.NY_OPEN_DATA_APP_TOKEN) headers["X-App-Token"] = this.env.NY_OPEN_DATA_APP_TOKEN;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`data.ny.gov returned ${res.status}`);
    return (await res.json()) as Row[];
  }

  private address(role: string, street?: string, line2?: string, city?: string, state?: string, zip?: string) {
    if (!street) return undefined;
    const address = normalizeAddress([street, line2, city, state, zip?.slice(0, 5)]);
    if (!address) return undefined;
    this.rawAddress.set(address, { street, zip });
    return { role, address };
  }

  toRecord(r: Row, retrievedAt = new Date().toISOString()): RegistryRecord {
    const addresses = [
      this.address("service of process", r.dos_process_address_1, r.dos_process_address_2, r.dos_process_city, r.dos_process_state, r.dos_process_zip),
      this.address("principal office", r.location_address_1, r.location_address_2, r.location_city, r.location_state, r.location_zip),
    ].filter((a): a is { role: string; address: string } => !!a)
      .filter((a, i, all) => all.findIndex((b) => b.address === a.address) === i);
    const agentAddress = r.registered_agent_address_1
      ? normalizeAddress([r.registered_agent_address_1, r.registered_agent_address_2, r.registered_agent_city, r.registered_agent_state, r.registered_agent_zip?.slice(0, 5)])
      : undefined;
    return {
      issuer: "us_ny",
      number: r.dos_id ?? "",
      name: r.current_entity_name ?? "",
      url: `${DATASET}?dos_id=${encodeURIComponent(r.dos_id ?? "")}`,
      sourceName: SOURCE_NAME,
      retrievedAt,
      officers: r.chairman_name ? [{ name: r.chairman_name, role: "chairman or CEO" }] : [],
      agent: r.registered_agent_name ? { name: r.registered_agent_name, address: agentAddress } : undefined,
      addresses,
    };
  }

  async findCompanies(name: string): Promise<RegistryRecord[]> {
    const rows = await this.query({ $where: `upper(current_entity_name) = ${q(name.toUpperCase())}`, $limit: "5" });
    const exact = rows.length > 0 ? rows : await this.query({
      // "Acme" also finds "ACME, INC." / "ACME LLC"; the engine keeps only
      // normalized-name matches.
      $where: `starts_with(upper(current_entity_name), ${q(name.toUpperCase())})`, $limit: "10",
    });
    return exact.filter((r) => r.dos_id).map((r) => this.toRecord(r));
  }

  async sharing(kind: LinkKind, value: string, limit: number): Promise<{ records: RegistryRecord[]; total: number }> {
    let where: string;
    if (kind === "officer") where = `upper(chairman_name) = ${q(value.toUpperCase())}`;
    else if (kind === "agent") where = `upper(registered_agent_name) = ${q(value.toUpperCase())}`;
    else {
      const raw = this.rawAddress.get(value);
      if (!raw) return { records: [], total: 0 };
      const street = q(raw.street.toUpperCase());
      const zip = raw.zip ? q(raw.zip) : undefined;
      where = zip
        ? `(upper(dos_process_address_1) = ${street} AND dos_process_zip = ${zip}) OR (upper(location_address_1) = ${street} AND location_zip = ${zip})`
        : `upper(dos_process_address_1) = ${street} OR upper(location_address_1) = ${street}`;
    }
    const [count, rows] = await Promise.all([
      this.query({ $select: "count(*) AS n", $where: where }),
      this.query({ $where: where, $limit: String(limit) }),
    ]);
    const records = rows.filter((r) => r.dos_id).map((r) => this.toRecord(r));
    return { records, total: Number(count[0]?.n ?? records.length) };
  }
}
