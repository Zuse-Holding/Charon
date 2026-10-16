/**
 * A public figure's photo for person reports: the lead image of their
 * English Wikipedia article, freely licensed on Wikimedia Commons, with the
 * artist and license the license requires us to show. It's there so the
 * reader can confirm the report is about the person they meant.
 *
 * Deliberately narrow:
 * - Only people with their own English Wikipedia article (a human, per
 *   Wikidata), never an image search by name, which returns strangers.
 * - Only freely licensed images (pilicense=free).
 * - No face matching of any kind.
 * - When the searcher typed an affiliation ("Daniel Olmos csun"), the
 *   article must mention it, or there's no photo: a same-name stranger's
 *   face is worse than none.
 * Excluded people never reach this: the agent server refuses the search first.
 */

export interface PersonPhoto {
  /** ~320px thumbnail served by Wikimedia. */
  imageUrl: string;
  /** Commons file page: full attribution and license terms. */
  filePageUrl: string;
  wikipediaUrl: string;
  wikipediaTitle: string;
  wikidataId: string;
  /** Wikipedia's short description, e.g. "American businessman (born 1971)". */
  description?: string;
  /** Plain text; Commons stores it as HTML. */
  artist?: string;
  license?: string;
  licenseUrl?: string;
}

type FetchFn = typeof fetch;

const USER_AGENT = "MetisIntelligence/1.0 (https://metisanalytic.com; support@metisanalytic.com)";
const HUMAN = "Q5";
const TIMEOUT_MS = 8000;

async function getJson(url: string, fetchFn: FetchFn): Promise<any> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const text = s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function mentions(text: string, affiliation: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return norm(text).includes(norm(affiliation.trim()));
}

/** null when there's no single, clearly matching public figure with a free image. */
export async function findPersonPhoto(
  name: string,
  opts: { affiliation?: string; fetchFn?: FetchFn } = {},
): Promise<PersonPhoto | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const title = name.trim();
  if (!title) return null;

  const wp = new URL("https://en.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    action: "query", format: "json", formatversion: "2", redirects: "1", titles: title,
    prop: "pageimages|pageprops|description|info|extracts", piprop: "thumbnail|name", pithumbsize: "320",
    pilicense: "free", inprop: "url", exintro: "1", explaintext: "1", exchars: "1200",
  })) wp.searchParams.set(k, v);
  const page = (await getJson(wp.toString(), fetchFn))?.query?.pages?.[0];
  if (!page || page.missing || page.invalid) return null;
  if (page.pageprops?.disambiguation !== undefined) return null; // "John Smith": many people, can't pick
  const wikidataId: string | undefined = page.pageprops?.wikibase_item;
  const fileName: string | undefined = page.pageimage;
  const thumb: string | undefined = page.thumbnail?.source;
  if (!wikidataId || !fileName || !thumb) return null;
  if (opts.affiliation && !mentions(`${page.description ?? ""} ${page.extract ?? ""}`, opts.affiliation)) return null;

  // A human, not a company, band or film that happens to share the name.
  const wd = new URL("https://www.wikidata.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "wbgetclaims", format: "json", entity: wikidataId, property: "P31" })) {
    wd.searchParams.set(k, v);
  }
  const claims = (await getJson(wd.toString(), fetchFn))?.claims?.P31 ?? [];
  if (!claims.some((c: any) => c?.mainsnak?.datavalue?.value?.id === HUMAN)) return null;

  const cm = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    action: "query", format: "json", formatversion: "2", titles: `File:${fileName}`,
    prop: "imageinfo", iiprop: "url|extmetadata", iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
  })) cm.searchParams.set(k, v);
  const info = (await getJson(cm.toString(), fetchFn))?.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};

  return {
    imageUrl: thumb,
    filePageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
    wikipediaUrl: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    wikipediaTitle: page.title,
    wikidataId,
    description: page.description || undefined,
    artist: stripHtml(meta.Artist?.value),
    license: stripHtml(meta.LicenseShortName?.value),
    licenseUrl: meta.LicenseUrl?.value || undefined,
  };
}
