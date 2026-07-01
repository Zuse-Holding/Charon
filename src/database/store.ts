import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PersonResearchBundle,
  ProductResearchBundle,
  ResearchBundle,
  WatchlistEntry,
  DeepDiveBundle,
} from "../types/research.js";

// Always resolve the database relative to the project root (the folder
// containing src/), regardless of whether we're called from the CLI
// (cwd = project root) or the Next.js dev server (cwd = web/).
const PROJECT_ROOT = (() => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = dirname(__filename);
  // __dirname is seline-intel/src/database at runtime
  return join(__dirname, "..", "..");
})();

const DB_DIR  = join(PROJECT_ROOT, "database");
const DB_PATH = join(DB_DIR, "store.json");

/**
 * Local persistence layer — single JSON file store for all research
 * runs, watchlist entries, and metadata. No native dependencies, no
 * network. Maps directly onto Supabase tables (companies, people,
 * products, reports, watchlist) for when cloud sync is needed later.
 */

export type RunType = "company" | "person" | "product";

export interface ResearchRunRecord {
  id: string;
  type: RunType;
  subject: string;
  generatedAt: string;
  reportPath: string;
  bundle: ResearchBundle | PersonResearchBundle | ProductResearchBundle;
}

interface StoreShape {
  runs: ResearchRunRecord[];
  watchlist: WatchlistEntry[];
  deepDives: DeepDiveBundle[];
}

function load(): StoreShape {
  if (!existsSync(DB_PATH)) return { runs: [], watchlist: [], deepDives: [] };
  try {
    const raw = readFileSync(DB_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { runs?: unknown[]; watchlist?: unknown[]; deepDives?: unknown[] };
    return {
      runs: (parsed.runs ?? []).map(normalizeRecord),
      watchlist: (parsed.watchlist ?? []) as WatchlistEntry[],
      deepDives: (parsed.deepDives ?? []) as DeepDiveBundle[],
    };
  } catch {
    return { runs: [], watchlist: [], deepDives: [] };
  }
}

function save(store: StoreShape): void {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function normalizeRecord(raw: unknown): ResearchRunRecord {
  const r = raw as Partial<ResearchRunRecord> & { company?: string };
  return {
    id: r.id ?? `legacy-${Math.random().toString(36).slice(2)}`,
    type: r.type ?? "company",
    subject: r.subject ?? r.company ?? "Unknown",
    generatedAt: r.generatedAt ?? new Date(0).toISOString(),
    reportPath: r.reportPath ?? "",
    bundle: r.bundle as ResearchRunRecord["bundle"],
  };
}

// --- Research runs ---

export function recordRun(record: ResearchRunRecord): void {
  const store = load();
  store.runs.push(record);
  save(store);
}

export function listRecent(limit = 10, type?: RunType): ResearchRunRecord[] {
  const store = load();
  return [...store.runs]
    .filter((r) => !type || r.type === type)
    .sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""))
    .slice(0, limit);
}

export function findLatestByName(
  name: string,
  type?: RunType
): ResearchRunRecord | null {
  const store = load();
  const lower = name.toLowerCase();
  const matches = store.runs
    .filter(
      (r) =>
        (r.subject ?? "").toLowerCase() === lower &&
        (!type || r.type === type)
    )
    .sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
  return matches[0] ?? null;
}

export function getAllRuns(): ResearchRunRecord[] {
  return load().runs.sort((a, b) =>
    (b.generatedAt ?? "").localeCompare(a.generatedAt ?? "")
  );
}

export function deleteRun(id: string): void {
  const store = load();
  store.runs = store.runs.filter((r) => r.id !== id);
  save(store);
}

// --- Watchlist ---

export function getWatchlist(): WatchlistEntry[] {
  return load().watchlist;
}

export function addToWatchlist(
  subject: string,
  type: RunType,
  refreshIntervalDays = 3
): WatchlistEntry {
  const store = load();
  const existing = store.watchlist.find(
    (w) => w.subject.toLowerCase() === subject.toLowerCase() && w.type === type
  );
  if (existing) return existing;

  const entry: WatchlistEntry = {
    id: `watch-${Date.now()}`,
    type,
    subject,
    addedAt: new Date().toISOString(),
    refreshIntervalDays,
  };
  store.watchlist.push(entry);
  save(store);
  return entry;
}

export function removeFromWatchlist(id: string): void {
  const store = load();
  store.watchlist = store.watchlist.filter((w) => w.id !== id);
  save(store);
}

export function updateWatchlistRefresh(id: string): void {
  const store = load();
  const entry = store.watchlist.find((w) => w.id === id);
  if (entry) {
    entry.lastRefreshedAt = new Date().toISOString();
    save(store);
  }
}

export function getStaleWatchlistEntries(): WatchlistEntry[] {
  const entries = getWatchlist();
  const now = Date.now();
  return entries.filter((e) => {
    const lastRefresh = e.lastRefreshedAt ?? e.addedAt;
    const ageMs = now - new Date(lastRefresh).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays >= e.refreshIntervalDays;
  });
}

// --- Deep Dives ---

export function saveDeepDive(bundle: DeepDiveBundle): void {
  const store = load();
  // Replace existing deep dive for this company if one exists
  store.deepDives = store.deepDives.filter(
    (d) => d.company.toLowerCase() !== bundle.company.toLowerCase()
  );
  store.deepDives.push(bundle);
  save(store);
}

export function getDeepDive(company: string): DeepDiveBundle | null {
  const store = load();
  return (
    store.deepDives.find(
      (d) => d.company.toLowerCase() === company.toLowerCase()
    ) ?? null
  );
}

export function getAllDeepDives(): DeepDiveBundle[] {
  return load().deepDives;
}
