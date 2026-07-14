import { NextRequest, NextResponse } from "next/server";

const SECTOR_QUERIES: Record<string, string> = {
  tech:       "tech startup funding acquisition product launch 2026",
  fintech:    "fintech payments startup funding round 2026",
  ai:         "artificial intelligence AI company launch product 2026",
  health:     "digital health biotech startup funding 2026",
  gaming:     "gaming company studio acquisition launch 2026",
  defense:    "defense aerospace startup contract funding 2026",
  climate:    "climate energy cleantech startup funding 2026",
  consumer:   "consumer brand retail startup funding acquisition 2026",
};

const SECTOR_LABELS: Record<string, string> = {
  tech:     "Tech & Software",
  fintech:  "Fintech & Payments",
  ai:       "AI & Machine Learning",
  health:   "Healthcare",
  gaming:   "Gaming",
  defense:  "Defense & Aerospace",
  climate:  "Climate & Energy",
  consumer: "Consumer & Retail",
};

// Domains to exclude from feed results
const NOISE_DOMAINS = ["youtube.com", "facebook.com", "instagram.com", "reddit.com", "twitter.com", "x.com"];

// Extract company names from a headline using simple heuristics
// Looks for capitalized proper nouns that aren't common words
const COMMON_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
  "but", "is", "are", "was", "were", "has", "have", "had", "will", "would",
  "new", "first", "last", "big", "top", "best", "how", "why", "what", "when",
  "where", "who", "which", "this", "that", "these", "those", "its", "their",
  "here", "there", "could", "should", "may", "might", "tech", "ai", "us",
  "report", "says", "raises", "launches", "announces", "acquires", "company",
  "startup", "billion", "million", "funding", "round", "series",
]);

function extractCompanyName(headline: string): string | null {
  // Pattern 1: "CompanyName raises/launches/acquires/announces..."
  const actionPattern = /^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:raises|launches|acquires|announces|closes|files|lands|partners|expands|debuts|secures|unveils|releases|reports|cuts|hires|names|appoints)/;
  const m1 = headline.match(actionPattern);
  if (m1 && !COMMON_WORDS.has(m1[1].toLowerCase())) return m1[1];

  // Pattern 2: "$XM/XB funding" — company name before dollar amount
  const fundingPattern = /^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:raises?|secures?|closes?)\s+\$[\d.]+[BMK]/i;
  const m2 = headline.match(fundingPattern);
  if (m2 && !COMMON_WORDS.has(m2[1].toLowerCase())) return m2[1];

  // Pattern 3: "CompanyName IPO/acquisition/merger"
  const corpPattern = /^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:IPO|acquisition|merger|deal|funding|round|valuation)/i;
  const m3 = headline.match(corpPattern);
  if (m3 && !COMMON_WORDS.has(m3[1].toLowerCase())) return m3[1];

  return null;
}

export async function GET(req: NextRequest) {
  const sector = req.nextUrl.searchParams.get("sector");
  if (!sector || !SECTOR_QUERIES[sector]) {
    // Logged so a 400 reported from an unusual environment (corporate
    // proxy/laptop stripping or rewriting query params, stale cached JS
    // bundle sending an old sector id, etc.) is actually diagnosable from
    // server logs instead of just "it 400'd" with no context.
    console.warn(`[intel-feed] Rejected request — sector param was: ${JSON.stringify(sector)}. Full query: ${req.nextUrl.search}`);
    return NextResponse.json({ error: "Invalid sector", received: sector }, { status: 400 });
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Search not configured" }, { status: 503 });
  }

  try {
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: SECTOR_QUERIES[sector], num: 8 }),
    });

    if (!res.ok) throw new Error(`Serper error: ${res.status}`);
    const data = await res.json();

    const items = (data.news ?? data.organic ?? [])
      .filter((r: any) => !NOISE_DOMAINS.some(d => (r.link ?? r.url ?? "").includes(d)))
      .slice(0, 5)
      .map((r: any) => ({
        headline: r.title,
        summary:  r.snippet ?? "",
        url:      r.link ?? r.url ?? "#",
        source:   r.source ?? "",
        company:  extractCompanyName(r.title),
      }));

    return NextResponse.json({
      sector,
      label: SECTOR_LABELS[sector],
      items,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
