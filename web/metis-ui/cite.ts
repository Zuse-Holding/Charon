// The text of a citation: "Harbor Line CIM.pdf, p. 14", "axios.com · Oct 16,
// 2026", "Financials.xlsx, B12". Pure, shared by SourceCite and any app code
// that needs the same words (PDF appendices, tests).

export function citeText(source: string, locator?: string | number | null): string {
  if (locator === null || locator === undefined || locator === "") return source;
  if (typeof locator === "number" || /^\d+$/.test(locator)) return `${source}, p. ${locator}`;
  // Dates read as metadata ("axios.com · Aug 19, 2026"); anything else (a
  // cell, a sheet, a section) as a location in the document.
  const dateLike = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d|\d{4}-\d{2}-\d{2}|^as of\b/i.test(locator);
  return dateLike ? `${source} · ${locator}` : `${source}, ${locator}`;
}

/** True for things that look like internal line-item keys (is.2023.revenue). */
export function looksLikeKey(text: string): boolean {
  return /^[a-z]{2,4}\.[a-z0-9_.]+$/.test(text) || /^(ab|rc)_\d+$/.test(text);
}
