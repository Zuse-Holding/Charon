import tls from "node:tls";
import type { Source } from "../../types/research.js";

/**
 * Passive domain posture check (Feature 5). For a target's website domain,
 * a short card from public records only:
 *
 *   RDAP          registration, expiry, registrant, transfer lock (the
 *                 registry found through IANA's RDAP bootstrap file)
 *   public DNS    NS, MX, SPF, DMARC, CAA (DNS over HTTPS, Cloudflare)
 *   TLS           certificate expiry, read from one ordinary HTTPS handshake
 *
 * Nothing else touches the target's servers: no port scans, no probing.
 * Each flag says, in plain English, why it matters to a buyer.
 */

export type CheckStatus = "ok" | "flag" | "info" | "unknown";
export type Severity = "high" | "medium" | "low";

export interface PostureCheck {
  id: "expiry" | "registrant" | "transfer_lock" | "dns" | "spf" | "dmarc" | "caa" | "tls";
  label: string;
  status: CheckStatus;
  severity?: Severity;
  /** What was found. */
  detail: string;
  /** Flags only: why it matters to a buyer. */
  impact?: string;
  sourceName: string;
  sourceUrl: string;
}

export interface DomainPosture {
  domain: string;
  checkedAt: string;
  checks: PostureCheck[];
}

/** Raw public-record facts; evaluatePosture turns them into the card. */
export interface DomainFacts {
  domain: string;
  rdap?: {
    url: string;
    expiresAt?: string;
    registeredAt?: string;
    status: string[];
    registrar?: string;
    registrant?: { hidden: boolean; kind?: string; name?: string; org?: string };
  };
  /** undefined = lookup failed; [] = no records. */
  ns?: string[];
  mx?: string[];
  txt?: string[];
  dmarc?: string[];
  caa?: string[];
  tls?: { validTo?: string; issuer?: string; error?: string };
}

const DOH = "https://cloudflare-dns.com/dns-query";
const DAY = 86_400_000;
const LEGAL_FORM = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|plc|gmbh|group|holdings|foundation|trust)\b\.?/i;

export const dohUrl = (name: string, type: string) => `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;

const days = (iso: string | undefined, now: Date) => (iso ? Math.floor((Date.parse(iso) - now.getTime()) / DAY) : undefined);
const dateOnly = (iso: string | undefined) => (iso ? iso.slice(0, 10) : "unknown");

export function evaluatePosture(f: DomainFacts, now = new Date()): DomainPosture {
  const checks: PostureCheck[] = [];
  const rdapUrl = f.rdap?.url ?? `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(f.domain)}`;
  const rdap = { sourceName: "RDAP registration record", sourceUrl: rdapUrl };

  // Registration and expiry
  const left = days(f.rdap?.expiresAt, now);
  if (!f.rdap || left === undefined) {
    checks.push({ id: "expiry", label: "Registration and expiry", status: "unknown", detail: "No expiry date in the public registration record.", ...rdap });
  } else if (left <= 90) {
    checks.push({
      id: "expiry", label: "Registration and expiry", status: "flag", severity: left <= 30 ? "high" : "medium",
      detail: left < 0 ? `Expired ${dateOnly(f.rdap.expiresAt)}.` : `Expires ${dateOnly(f.rdap.expiresAt)}, in ${left} day${left === 1 ? "" : "s"}.`,
      impact: "The domain could lapse around closing. Make renewal (ideally for several years) a closing condition.",
      ...rdap,
    });
  } else {
    checks.push({ id: "expiry", label: "Registration and expiry", status: "ok",
      detail: `Registered ${dateOnly(f.rdap.registeredAt)}; expires ${dateOnly(f.rdap.expiresAt)}${f.rdap.registrar ? ` (registrar: ${f.rdap.registrar})` : ""}.`, ...rdap });
  }

  // Registrant type
  const reg = f.rdap?.registrant;
  if (!f.rdap) {
    checks.push({ id: "registrant", label: "Registrant", status: "unknown", detail: "Registration record unavailable.", ...rdap });
  } else if (!reg || reg.hidden) {
    checks.push({ id: "registrant", label: "Registrant", status: "info", detail: "Registrant hidden (privacy-protected record).", ...rdap });
  } else {
    const individual = reg.kind === "individual" || (!reg.org && !!reg.name && !LEGAL_FORM.test(reg.name));
    checks.push(individual
      ? { id: "registrant", label: "Registrant", status: "flag", severity: "medium",
          detail: `Registered to an individual${reg.name ? ` (${reg.name})` : ""}, not the business.`,
          impact: "The domain is in a person's name, not the company's. Make its transfer to the business a closing condition.", ...rdap }
      : { id: "registrant", label: "Registrant", status: "ok", detail: `Registered to ${reg.org ?? reg.name}.`, ...rdap });
  }

  // Transfer lock
  if (f.rdap) {
    const locked = f.rdap.status.some((s) => s.toLowerCase().replace(/\s+/g, "") === "clienttransferprohibited");
    checks.push(locked
      ? { id: "transfer_lock", label: "Transfer lock", status: "ok", detail: "Transfer lock is on (clientTransferProhibited).", ...rdap }
      : { id: "transfer_lock", label: "Transfer lock", status: "flag", severity: "medium", detail: "No registrar transfer lock (clientTransferProhibited is not set).",
          impact: "Without a transfer lock the domain is easier to hijack or move away. Ask the seller to turn it on before closing.", ...rdap });
  }

  // DNS and mail provider (informational)
  const nsUrl = dohUrl(f.domain, "NS");
  if (f.ns === undefined && f.mx === undefined) {
    checks.push({ id: "dns", label: "DNS and mail provider", status: "unknown", detail: "DNS lookup failed.", sourceName: "Public DNS", sourceUrl: nsUrl });
  } else {
    const ns = f.ns?.length ? f.ns.join(", ") : "none found";
    const mx = f.mx?.length ? f.mx.join(", ") : "no mail servers (MX) published";
    checks.push({ id: "dns", label: "DNS and mail provider", status: "info", detail: `Name servers: ${ns}. Mail: ${mx}.`, sourceName: "Public DNS", sourceUrl: nsUrl });
  }

  // SPF
  const spfUrl = dohUrl(f.domain, "TXT");
  if (f.txt === undefined) {
    checks.push({ id: "spf", label: "SPF", status: "unknown", detail: "TXT lookup failed.", sourceName: "Public DNS (TXT)", sourceUrl: spfUrl });
  } else {
    const spf = f.txt.find((t) => /^v=spf1(\s|$)/i.test(t));
    const allMech = spf?.trim().split(/\s+/).find((m) => /^[+?~-]?all$/i.test(m));
    if (!spf) {
      checks.push({ id: "spf", label: "SPF", status: "flag", severity: "medium", detail: "No SPF record.",
        impact: "Anyone can send email that appears to come from this domain, which makes invoice and payment fraud easier.", sourceName: "Public DNS (TXT)", sourceUrl: spfUrl });
    } else if (allMech && (allMech === "all" || allMech.startsWith("+"))) {
      checks.push({ id: "spf", label: "SPF", status: "flag", severity: "high", detail: `SPF ends in ${allMech === "all" ? "all (same as +all)" : "+all"}: it authorizes every server.`,
        impact: "The SPF record allows any server to send as this domain, so it gives no protection against spoofed email.", sourceName: "Public DNS (TXT)", sourceUrl: spfUrl });
    } else {
      checks.push({ id: "spf", label: "SPF", status: "ok", detail: `SPF published: ${spf}`, sourceName: "Public DNS (TXT)", sourceUrl: spfUrl });
    }
  }

  // DMARC
  const dmarcUrl = dohUrl(`_dmarc.${f.domain}`, "TXT");
  if (f.dmarc === undefined) {
    checks.push({ id: "dmarc", label: "DMARC", status: "unknown", detail: "DMARC lookup failed.", sourceName: "Public DNS (_dmarc TXT)", sourceUrl: dmarcUrl });
  } else {
    const rec = f.dmarc.find((t) => /^v=DMARC1/i.test(t));
    const policy = rec?.match(/(?:^|;)\s*p\s*=\s*(\w+)/i)?.[1]?.toLowerCase();
    if (!rec) {
      checks.push({ id: "dmarc", label: "DMARC", status: "flag", severity: "medium", detail: "No DMARC record.",
        impact: "Spoofed email from this domain isn't rejected, so fake invoices or payment-change requests can reach customers and staff.",
        sourceName: "Public DNS (_dmarc TXT)", sourceUrl: dmarcUrl });
    } else if (!policy || policy === "none") {
      checks.push({ id: "dmarc", label: "DMARC", status: "flag", severity: "low", detail: "DMARC is set to p=none (monitoring only).",
        impact: "DMARC only reports spoofed email and doesn't block it. Moving to quarantine or reject is a quick fix to ask for.",
        sourceName: "Public DNS (_dmarc TXT)", sourceUrl: dmarcUrl });
    } else {
      checks.push({ id: "dmarc", label: "DMARC", status: "ok", detail: `DMARC policy: p=${policy}.`, sourceName: "Public DNS (_dmarc TXT)", sourceUrl: dmarcUrl });
    }
  }

  // CAA
  const caaUrl = dohUrl(f.domain, "CAA");
  if (f.caa === undefined) {
    checks.push({ id: "caa", label: "CAA", status: "unknown", detail: "CAA lookup failed.", sourceName: "Public DNS (CAA)", sourceUrl: caaUrl });
  } else if (f.caa.length === 0) {
    checks.push({ id: "caa", label: "CAA", status: "flag", severity: "low", detail: "No CAA record.",
      impact: "Any certificate authority may issue certificates for this domain. Low risk, but a CAA record is a cheap safeguard.",
      sourceName: "Public DNS (CAA)", sourceUrl: caaUrl });
  } else {
    checks.push({ id: "caa", label: "CAA", status: "ok", detail: `CAA limits certificate issuers (${f.caa.length} record${f.caa.length === 1 ? "" : "s"}).`, sourceName: "Public DNS (CAA)", sourceUrl: caaUrl });
  }

  // TLS certificate
  const tlsSource = { sourceName: "TLS certificate (HTTPS handshake)", sourceUrl: `https://${f.domain}/` };
  const certLeft = days(f.tls?.validTo, now);
  if (!f.tls || certLeft === undefined) {
    checks.push({ id: "tls", label: "TLS certificate", status: "unknown", detail: f.tls?.error ? `Couldn't read the certificate: ${f.tls.error}.` : "Couldn't read the certificate.", ...tlsSource });
  } else if (certLeft <= 30) {
    checks.push({ id: "tls", label: "TLS certificate", status: "flag", severity: certLeft < 0 ? "high" : "medium",
      detail: certLeft < 0 ? `Certificate expired ${dateOnly(f.tls.validTo)}.` : `Certificate expires ${dateOnly(f.tls.validTo)}, in ${certLeft} day${certLeft === 1 ? "" : "s"}.`,
      impact: "Visitors will see security warnings when it lapses. Check that renewal is automated.", ...tlsSource });
  } else {
    checks.push({ id: "tls", label: "TLS certificate", status: "ok",
      detail: `Certificate valid until ${dateOnly(f.tls.validTo)}${f.tls.issuer ? `, issued by ${f.tls.issuer.replace(/\.$/, "")}` : ""}.`, ...tlsSource });
  }

  return { domain: f.domain, checkedAt: now.toISOString(), checks };
}

// --- Gathering public records ---

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, unknown][]];
  remarks?: { title?: string; description?: string[] }[];
  entities?: RdapEntity[];
}
interface RdapDomain {
  status?: string[];
  events?: { eventAction: string; eventDate: string }[];
  entities?: RdapEntity[];
  links?: { rel?: string; href?: string; type?: string }[];
}

const REDACTED = /redacted|privacy|withheld|not disclosed|data protected|proxy|guard|statutory masking/i;

function vcard(e: RdapEntity, field: string): string | undefined {
  const v = e.vcardArray?.[1]?.find((x) => x[0] === field)?.[3];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function findRole(entities: RdapEntity[] | undefined, role: string): RdapEntity | undefined {
  for (const e of entities ?? []) {
    if (e.roles?.includes(role)) return e;
    const nested = findRole(e.entities, role);
    if (nested) return nested;
  }
  return undefined;
}

export function parseRdap(url: string, registry: RdapDomain, registrar?: RdapDomain): NonNullable<DomainFacts["rdap"]> {
  const event = (a: string) => registry.events?.find((e) => e.eventAction === a)?.eventDate
    ?? registrar?.events?.find((e) => e.eventAction === a)?.eventDate;
  const registrantEntity = findRole(registrar?.entities, "registrant") ?? findRole(registry.entities, "registrant");
  let registrant: NonNullable<DomainFacts["rdap"]>["registrant"];
  if (registrantEntity) {
    const name = vcard(registrantEntity, "fn");
    const org = vcard(registrantEntity, "org");
    const kind = vcard(registrantEntity, "kind");
    const remarks = (registrantEntity.remarks ?? []).map((r) => `${r.title ?? ""} ${(r.description ?? []).join(" ")}`).join(" ");
    const hidden = (!name && !org) || REDACTED.test(`${name ?? ""} ${org ?? ""}`) || REDACTED.test(remarks);
    registrant = { hidden, kind, name: hidden ? undefined : name, org: hidden ? undefined : org };
  }
  const registrarEntity = findRole(registry.entities, "registrar");
  return {
    url,
    expiresAt: event("expiration"),
    registeredAt: event("registration"),
    status: [...new Set([...(registry.status ?? []), ...(registrar?.status ?? [])])],
    registrar: registrarEntity ? vcard(registrarEntity, "fn") : undefined,
    registrant,
  };
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return (await res.json()) as T;
}

const DNS_TYPES: Record<string, number> = { NS: 2, MX: 15, TXT: 16, CAA: 257 };

/** Record data for one name and type; [] when none exist. */
export async function dnsLookup(name: string, type: keyof typeof DNS_TYPES): Promise<string[]> {
  const data = await getJson<{ Status: number; Answer?: { type: number; data: string }[] }>(dohUrl(name, type), { accept: "application/dns-json" });
  if (data.Status !== 0 && data.Status !== 3) throw new Error(`DNS lookup failed (status ${data.Status})`);
  return (data.Answer ?? [])
    .filter((a) => a.type === DNS_TYPES[type])
    .map((a) => (type === "TXT" ? a.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "") : a.data.replace(/\.$/, "")));
}

/** Reads the certificate from one ordinary TLS handshake on port 443. */
function readCertificate(domain: string): Promise<{ validTo?: string; issuer?: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) return resolve({ error: "no certificate presented" });
      const issuer = cert.issuer?.O ?? cert.issuer?.CN;
      resolve({ validTo: new Date(cert.valid_to).toISOString(), issuer: Array.isArray(issuer) ? issuer[0] : issuer });
    });
    socket.on("timeout", () => { socket.destroy(); resolve({ error: "timed out" }); });
    socket.on("error", (err) => resolve({ error: err.message }));
  });
}

const settle = <T>(p: Promise<T>) => p.then((v) => v, () => undefined);

const BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
let bootstrap: Promise<[string[], string[]][]> | undefined;

/** The registry's RDAP base URL for a domain, from IANA's bootstrap file
 *  (RFC 9224). Undefined when the TLD publishes no RDAP service. */
export async function rdapBase(domain: string): Promise<string | undefined> {
  bootstrap ??= getJson<{ services: [string[], string[]][] }>(BOOTSTRAP).then((b) => b.services)
    .catch((err) => { bootstrap = undefined; throw err; });
  const services = await bootstrap;
  const labels = domain.toLowerCase().split(".");
  // longest matching suffix wins (e.g. "co.uk" before "uk")
  for (let i = 1; i < labels.length; i++) {
    const tld = labels.slice(i).join(".");
    const svc = services.find(([tlds]) => tlds.includes(tld));
    const base = svc?.[1].find((u) => u.startsWith("https://")) ?? svc?.[1][0];
    if (base) return base.endsWith("/") ? base : `${base}/`;
  }
  return undefined;
}

export class DomainPostureAgent {
  async gather(domain: string): Promise<DomainFacts> {
    const rdap = async () => {
      const base = await rdapBase(domain);
      if (!base) return undefined;
      const rdapUrl = `${base}domain/${encodeURIComponent(domain)}`;
      const registry = await getJson<RdapDomain>(rdapUrl, { accept: "application/rdap+json" });
      const related = registry.links?.find((l) => l.rel === "related" && l.type === "application/rdap+json" && l.href?.startsWith("https://"))?.href;
      const registrar = related ? await settle(getJson<RdapDomain>(related, { accept: "application/rdap+json" })) : undefined;
      return parseRdap(rdapUrl, registry, registrar);
    };
    const [rdapFacts, ns, mx, txt, dmarc, caa, cert] = await Promise.all([
      settle(rdap()),
      settle(dnsLookup(domain, "NS")),
      settle(dnsLookup(domain, "MX")),
      settle(dnsLookup(domain, "TXT")),
      settle(dnsLookup(`_dmarc.${domain}`, "TXT")),
      settle(dnsLookup(domain, "CAA")),
      readCertificate(domain),
    ]);
    return { domain, rdap: rdapFacts, ns, mx, txt, dmarc, caa, tls: cert };
  }

  async run(domain: string): Promise<{ posture?: DomainPosture; sources: Source[] }> {
    const facts = await this.gather(domain);
    const posture = evaluatePosture(facts);
    // Nothing answered at all: no card, so coverage reports an error.
    if (posture.checks.every((c) => c.status === "unknown")) return { sources: [] };
    const retrievedAt = posture.checkedAt;
    const sources: Source[] = [...new Map(posture.checks.map((c) => [c.sourceUrl, c])).values()]
      .map((c) => ({ url: c.sourceUrl, title: c.sourceName, retrievedAt, usedFor: ["domain"] }));
    return { posture, sources };
  }
}
