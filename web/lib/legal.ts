/**
 * Single flag gating the "DRAFT — PENDING LEGAL REVIEW" badge on
 * /privacy and /terms (task 2.5). Flip to true only after an attorney has
 * actually reviewed both pages — this is a business/legal decision, not
 * something to change as part of a code change. See CHECKLIST.md.
 */
export const LEGAL_PAGES_FINAL = false;
