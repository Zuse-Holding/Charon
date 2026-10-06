// Browser-side copy of src/lib/flags.ts. Same rule: off unless set to
// on/true/1. NEXT_PUBLIC_ values are baked in at build time, so changing
// one needs a redeploy.
export type Flag = "provenance";

const VALUES: Record<Flag, string | undefined> = {
  // Literal property access: Next only inlines NEXT_PUBLIC_ vars written out in full.
  provenance: process.env.NEXT_PUBLIC_FEATURE_PROVENANCE,
};

export function isEnabled(flag: Flag): boolean {
  const value = VALUES[flag]?.trim().toLowerCase();
  return value === "on" || value === "true" || value === "1";
}

/** Same wording as REPORT_DISCLAIMER in src/lib/disclaimer.ts. */
export const REPORT_DISCLAIMER =
  "Not a consumer report. Metis is not a consumer reporting agency, and this report must not be used to decide anyone's eligibility for employment, credit, housing or insurance.";
