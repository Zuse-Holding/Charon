/**
 * Feature flags for the provenance & trust work (see CHANGELOG.md).
 * Every flag is OFF unless its environment variable is set to on/true/1,
 * so a deploy that doesn't mention a flag never turns anything on.
 *
 *   FEATURE_PROVENANCE=on   per-finding provenance (Feature 2)
 *
 * Server-side only. The web app reads its own NEXT_PUBLIC_FEATURE_* copy
 * where the UI needs to know (see web/lib/flags.ts).
 */
export type Flag = "provenance";

export function isEnabled(flag: Flag, env: Record<string, string | undefined> = process.env): boolean {
  const value = env[`FEATURE_${flag.toUpperCase()}`]?.trim().toLowerCase();
  return value === "on" || value === "true" || value === "1";
}
