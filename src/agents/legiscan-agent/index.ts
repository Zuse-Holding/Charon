import { SponsoredBillEntry, Source } from "../../types/research.js";

/**
 * LegiScan Agent (Round 2 v2) — state + federal legislator lookup via
 * LegiScan's bulk legislative-tracking API (api.legiscan.com).
 *
 * Requires LEGISCAN_API_KEY (free tier available). Main value-add over
 * congress-agent: covers state legislators and governors, which
 * Congress.gov has no data on at all.
 *
 * LegiScan has no "search person by name" operation, so this does a
 * two-hop resolution: getSessionList(state) -> most recent session ->
 * getSessionPeople(session) -> fuzzy name match -> people_id ->
 * getSponsoredList(people_id). Requires a two-letter state code to even
 * start — pass whatever the political-agent/congress-agent resolved for
 * this person's state. Returns empty gracefully if state is unknown
 * rather than guessing.
 *
 * NOTE: LegiScan does not expose committee assignments in a clean,
 * documented field through this path, so this agent does not claim to
 * provide committee data — only role/party/district confirmation and a
 * recent-bills-sponsored list. Committee assignments remain a gap (see
 * the political-agent v2 note) until a source that reliably has them
 * (e.g. a state legislature's own site) is wired in.
 */

const LEGISCAN_BASE = "https://api.legiscan.com/";

interface LsSessionListItem {
  session_id: number;
  year_end?: number;
}

interface LsSessionPerson {
  people_id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  party?: string;
  role?: string;
  district?: string;
}

interface LsSponsoredBill {
  bill_id: number;
  number?: string;
  title?: string;
  last_action?: string;
  last_action_date?: string;
  url?: string;
}

export class LegiScanAgent {
  private apiKey = process.env.LEGISCAN_API_KEY;

  private async call<T>(op: string, params: Record<string, string | number>): Promise<T | null> {
    if (!this.apiKey) return null;
    const qs = new URLSearchParams({ key: this.apiKey, op });
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

    try {
      const res = await fetch(`${LEGISCAN_BASE}?${qs.toString()}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.warn(`[legiscan-agent] op=${op} — HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { status?: string } & Record<string, unknown>;
      if (data.status && data.status !== "OK") {
        console.warn(`[legiscan-agent] op=${op} — API status "${data.status}"`);
        return null;
      }
      return data as T;
    } catch (err) {
      console.warn(`[legiscan-agent] op=${op} — request failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async run(name: string, state?: string): Promise<{
    sponsoredLegislation: SponsoredBillEntry[];
    role?: string;
    party?: string;
    district?: string;
    sources: Source[];
  }> {
    if (!this.apiKey || !state) return { sponsoredLegislation: [], sources: [] };

    const sessionData = await this.call<{ sessions?: LsSessionListItem[] }>("getSessionList", { state });
    const sessions = sessionData?.sessions ?? [];
    if (sessions.length === 0) {
      console.warn(`[legiscan-agent] "${name}" (${state}) — no sessions found`);
      return { sponsoredLegislation: [], sources: [] };
    }

    const currentSession = [...sessions].sort((a, b) => (b.year_end ?? 0) - (a.year_end ?? 0))[0];

    const peopleData = await this.call<{ sessionpeople?: { people?: LsSessionPerson[] } }>(
      "getSessionPeople",
      { id: currentSession.session_id }
    );
    const people = peopleData?.sessionpeople?.people ?? [];
    if (people.length === 0) {
      console.warn(`[legiscan-agent] "${name}" (${state}) — no session-people data`);
      return { sponsoredLegislation: [], sources: [] };
    }

    const needle = name.toLowerCase();
    const fullNameOf = (p: LsSessionPerson) => (p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`).trim().toLowerCase();
    const match =
      people.find((p) => fullNameOf(p) === needle) ??
      people.find((p) => fullNameOf(p).includes(needle) || needle.includes(fullNameOf(p))) ??
      people.find((p) => (p.last_name ?? "").length > 2 && needle.includes((p.last_name as string).toLowerCase()));

    if (!match) {
      console.warn(`[legiscan-agent] "${name}" (${state}) — no name match among ${people.length} session-people records`);
      return { sponsoredLegislation: [], sources: [] };
    }

    const sponsoredData = await this.call<{ sponsoredbills?: LsSponsoredBill[] }>(
      "getSponsoredList",
      { id: match.people_id }
    );

    const sponsoredLegislation: SponsoredBillEntry[] = (sponsoredData?.sponsoredbills ?? [])
      .slice(0, 10)
      .map((b) => ({
        billId: b.number ?? String(b.bill_id),
        title: b.title ?? "Untitled",
        latestAction: b.last_action,
        latestActionDate: b.last_action_date,
        url: b.url,
      }));

    const sources: Source[] = [{
      url: `https://legiscan.com/${state}`,
      title: `LegiScan — ${name} (${state})`,
      retrievedAt: new Date().toISOString(),
      usedFor: ["voting-record"],
    }];

    return {
      sponsoredLegislation,
      role: match.role,
      party: match.party,
      district: match.district,
      sources,
    };
  }
}
