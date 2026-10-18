// Quota wording and status, shared by QuotaBadge and any app code that
// needs the same line as plain text (banners, emails).

export interface QuotaBadgeProps {
  used: number;
  limit: number;
  /** Plural noun: "profiles", "Deep Dives", "reports". */
  unit: string;
  /** "Nov 1", "3:42 PM"; omit when it doesn't reset. */
  resets?: string | null;
  /** Share of the limit at which it reads as "almost out". */
  warnAt?: number;
}

export type QuotaStatus = "ok" | "warn" | "danger";

export function quotaStatus(used: number, limit: number, warnAt = 0.8): QuotaStatus {
  if (limit <= 0) return "ok";
  if (used >= limit) return "danger";
  return used / limit >= warnAt ? "warn" : "ok";
}

export function quotaText({ used, limit, unit, resets }: QuotaBadgeProps): string {
  return `${used} of ${limit} ${unit} used${resets ? ` · resets ${resets}` : ""}`;
}
