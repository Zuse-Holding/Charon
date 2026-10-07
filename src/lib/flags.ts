/**
 * Feature flags for the provenance & trust work (see CHANGELOG.md).
 * Every flag is OFF unless its environment variable is set to on/true/1,
 * so a deploy that doesn't mention a flag never turns anything on.
 *
 *   FEATURE_PROVENANCE=on   per-finding provenance (Feature 2)
 *   FEATURE_COVERAGE=on     source coverage ledger (Feature 1)
 *   FEATURE_ENTITY_RESOLUTION=on  identifier-based entity resolution (Feature 3)
 *   FEATURE_DOMAIN_POSTURE=on     passive domain posture check (Feature 5)
 *   FEATURE_SELF_EXCLUSION=on     self-exclusion list (Feature 6)
 *   FEATURE_RELATED_ENTITIES=on   related-entities expansion (Feature 4; needs Feature 6 on for users)
 *
 * Server-side only. The web app reads its own NEXT_PUBLIC_FEATURE_* copy
 * where the UI needs to know (see web/lib/flags.ts).
 */
export type Flag = "provenance" | "coverage" | "entity_resolution" | "domain_posture" | "self_exclusion" | "related_entities";

export function isEnabled(flag: Flag, env: Record<string, string | undefined> = process.env): boolean {
  const value = env[`FEATURE_${flag.toUpperCase()}`]?.trim().toLowerCase();
  return value === "on" || value === "true" || value === "1";
}
