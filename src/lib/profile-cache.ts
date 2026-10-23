import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ResearchBundle } from "../types/research.js";

/**
 * Verified company profile, kept per domain (round 10). Each run re-derived
 * the basics from scratch, so they wobbled: Limbach's founding year read
 * 1901, then 1900, then 2019; Graybar's went from 1869 to "Unknown"; ACCO's
 * employee ownership came and went. A value with a source is saved once
 * and reused; a later run only fills what it's missing from it, and a
 * filed value (the 10-K) still wins over the saved one.
 *
 * Behind FEATURE_FACT_CACHE; needs the company_profiles table (see the
 * block at the end of supabase/schema.sql). Fails open: no client, no table
 * or a failed call just means no cache.
 */

export interface CompanyProfileRecord {
  domain: string;
  legal_name?: string | null;
  founded?: string | null;
  founded_source?: string | null;
  headquarters?: string | null;
  ownership?: string | null;
  ownership_source?: string | null;
  updated_at?: string;
}

let client: SupabaseClient | null | undefined;
function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

export async function loadProfile(domain: string | undefined): Promise<CompanyProfileRecord | undefined> {
  const db = domain ? getClient() : null;
  if (!db || !domain) return undefined;
  try {
    const { data, error } = await db.from("company_profiles").select("*").eq("domain", domain).maybeSingle();
    if (error) { console.error("[profile-cache] load:", error.message); return undefined; }
    return (data as CompanyProfileRecord | null) ?? undefined;
  } catch (err) {
    console.error("[profile-cache] load failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * A founding year that comes after the company's own domain was registered
 * by more than two years is a misread (round 10: Limbach, domain 1996,
 * "founded 2019"; that year is when its holding company re-listed). A filed
 * year is never second-guessed.
 */
export function suspiciousFounded(bundle: ResearchBundle): boolean {
  const c = bundle.company;
  const year = Number(c.founded?.match(/\b(1[6-9]|20)\d{2}\b/)?.[0]);
  const reg = Number(bundle.domainPosture?.registeredAt?.slice(0, 4));
  if (!year || !reg || (c.foundedSource && /sec\.gov/i.test(c.foundedSource))) return false;
  return year > reg + 2;
}

/** Fills the bundle's empty basics from the saved profile. Pure; returns what it filled. */
export function applyProfile(bundle: ResearchBundle, p: CompanyProfileRecord | undefined): string[] {
  if (!p) return [];
  const c = bundle.company;
  const filled: string[] = [];
  const filed = !!c.foundedSource && /sec\.gov/i.test(c.foundedSource);
  // A saved, sourced year beats one re-read off a page this run; never a filed one.
  if (p.founded && p.founded_source && !filed && c.founded !== p.founded) {
    if (c.founded) console.log(`[profile-cache] "${c.name}": founded ${c.founded} kept as saved ${p.founded}`);
    c.founded = p.founded; c.foundedSource = p.founded_source; filled.push(`founded ${p.founded}`);
  }
  if (!c.headquarters && p.headquarters) { c.headquarters = p.headquarters; filled.push(`headquarters ${p.headquarters}`); }
  if (!c.legalName && p.legal_name) { c.legalName = p.legal_name; filled.push("legal name"); }
  if (!bundle.ownership && p.ownership && p.ownership_source) {
    bundle.ownership = p.ownership;
    if (!bundle.sources.some((s) => s.url === p.ownership_source)) {
      bundle.sources.push({ url: p.ownership_source, title: "Ownership", retrievedAt: p.updated_at ?? new Date().toISOString(), usedFor: ["funding"] });
    }
    filled.push(`ownership ${p.ownership}`);
  }
  return filled;
}

/** The record to save from a finished bundle: only values with a source. Pure. */
export function profileFrom(bundle: ResearchBundle, domain: string, prior?: CompanyProfileRecord): CompanyProfileRecord | undefined {
  const c = bundle.company;
  const ownershipSource = bundle.ownership ? bundle.sources.find((s) => s.usedFor.includes("funding") && s.title === "Ownership")?.url
    ?? bundle.sources.find((s) => s.usedFor.includes("funding"))?.url : undefined;
  const foundedSource = suspiciousFounded(bundle) ? undefined : c.foundedSource ?? (c.founded ? c.website : undefined);
  const year = c.founded?.match(/\b(1[6-9]|20)\d{2}\b/)?.[0];
  // Keep a saved year unless this one is filed.
  const keepPriorYear = prior?.founded && prior.founded_source && !(foundedSource && /sec\.gov/i.test(foundedSource));
  const rec: CompanyProfileRecord = {
    domain,
    legal_name: c.legalName ?? prior?.legal_name ?? null,
    founded: keepPriorYear ? prior!.founded : (year && foundedSource ? year : prior?.founded ?? null),
    founded_source: keepPriorYear ? prior!.founded_source : (year && foundedSource ? foundedSource : prior?.founded_source ?? null),
    headquarters: c.headquarters && !c.headquartersUnverified ? c.headquarters : prior?.headquarters ?? null,
    ownership: bundle.ownership && ownershipSource ? bundle.ownership : prior?.ownership ?? null,
    ownership_source: bundle.ownership && ownershipSource ? ownershipSource : prior?.ownership_source ?? null,
    updated_at: new Date().toISOString(),
  };
  return rec.founded || rec.headquarters || rec.ownership || rec.legal_name ? rec : undefined;
}

export async function saveProfile(rec: CompanyProfileRecord | undefined): Promise<void> {
  const db = rec ? getClient() : null;
  if (!db || !rec) return;
  try {
    const { error } = await db.from("company_profiles").upsert(rec, { onConflict: "domain" });
    if (error) console.error("[profile-cache] save:", error.message);
  } catch (err) {
    console.error("[profile-cache] save failed:", err instanceof Error ? err.message : err);
  }
}
