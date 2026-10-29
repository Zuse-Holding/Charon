/**
 * SSRF guard for fetching addresses that came from search results or
 * user input (red team S7). A public-looking domain can resolve to, or
 * redirect to, an internal address (cloud metadata, Railway's private
 * network, localhost); every hop is checked before it's fetched.
 *
 * Checked at lookup time, so a host that changes its DNS answer between
 * this check and the fetch (DNS rebinding) isn't covered; that needs a
 * connect-time check in the HTTP client.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipv4Private(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)   // carrier-grade NAT
    || (a === 169 && b === 254)             // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) // IETF, TEST-NET-1
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || a >= 224;                            // multicast, reserved, broadcast
}

/** True when the address is not reachable on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v !== 6) return true;
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  return lower === "::" || lower === "::1"
    || /^f[cd]/.test(lower)        // unique local fc00::/7
    || /^fe[89ab]/.test(lower)     // link-local fe80::/10
    || /^ff/.test(lower)           // multicast
    || lower.startsWith("64:ff9b:") // NAT64, can embed private IPv4
    || lower.startsWith("::ffff:"); // other IPv4-mapped forms
}

/** Why the address can't be fetched, or null when it's a public http(s) address. */
export async function unsafeUrlReason(url: string): Promise<string | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "the address isn't valid"; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "the address isn't a web page";
  if (parsed.username || parsed.password) return "the address isn't a web page";
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? "the address is on a private network" : null;
  if (host === "localhost" || /\.(localhost|local|internal)$/i.test(host)) return "the address is on a private network";
  // A name that doesn't resolve is left to the fetch, which fails the
  // same way and reports it; only a private answer is refused here.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return null;
  }
  return addresses.some((a) => isPrivateAddress(a.address)) ? "the address is on a private network" : null;
}
