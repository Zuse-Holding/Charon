/**
 * Every sec.gov request goes through here (launch fix 52: 403s from
 * efts.sec.gov and www.sec.gov on every run). The SEC's fair-access rules:
 * a User-Agent naming the company and a contact email, gzip accepted, and
 * no more than 10 requests a second from one client. SEC_USER_AGENT
 * overrides the default if the SEC asks for a different contact.
 *
 * A 403 logs the start of the SEC's answer: its "undeclared automated
 * tool" page means the header was refused; a plain block page means the
 * server's IP range is.
 */

export const SEC_USER_AGENT = process.env.SEC_USER_AGENT ?? "Metis Analytics support@metisanalytic.com";

// 8 a second, under the SEC's 10, shared by every caller in the process.
const SPACING_MS = 125;
let nextSlot = 0;

async function slot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + SPACING_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function secFetch(url: string, timeoutMs = 20_000, accept = "application/json, text/html, */*"): Promise<Response | null> {
  await slot();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": SEC_USER_AGENT, "accept-encoding": "gzip, deflate", accept },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = res.status === 403 ? (await res.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160) : "";
      console.warn(`[sec] ${new URL(url).host}${new URL(url).pathname} returned ${res.status}${body ? `: ${body}` : ""}`);
      return null;
    }
    return res;
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause;
    console.warn(`[sec] ${url.split("?")[0]} failed:`, err instanceof Error ? err.message : err, cause?.code ?? "");
    return null;
  }
}

export async function secJson<T>(url: string, timeoutMs?: number): Promise<T | null> {
  const res = await secFetch(url, timeoutMs, "application/json");
  if (!res) return null;
  try { return (await res.json()) as T; } catch { return null; }
}

export async function secText(url: string, timeoutMs = 30_000): Promise<string | null> {
  const res = await secFetch(url, timeoutMs);
  return res ? res.text().catch(() => null) : null;
}
