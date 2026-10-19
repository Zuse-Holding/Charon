/**
 * Where sign-in sends someone back to. Shared by the middleware (which sets
 * `?next=`), the login page and the OAuth callback (which follow it), and
 * SessionGuard (which sets it when a session expires mid-task).
 */

// Pages and API routes that need a session. Everything else is public.
export const PRIVATE_PREFIXES = [
  "/app",
  "/dashboard",
  "/settings",
  "/watchlist",
  "/intel-feed",
  "/knowledge-graph",
  "/reports",
  "/api",
];

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * `raw` if it's a path on this site, else `fallback`. Rejects anything that
 * could leave the site: "//host", "/\host", a scheme, or "@host" (which,
 * appended to an origin, becomes a login on another host).
 */
export function safeNext(raw: string | null | undefined, fallback = "/app"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(raw)) return fallback;
  return raw;
}
