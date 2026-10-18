import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { notFound } from "next/navigation";
import ReportIssueForm from "../../../components/ReportIssueForm";
import PrintButton from "./PrintButton";
import { REPORT_DISCLAIMER } from "../../../lib/flags";

interface Section {
  title: string;
  content: string;
  riskLevel?: string;
}

interface DeepDiveBundle {
  sections: Section[];
  company: string;
  generatedAt: string;
  durationMs?: number;
}

// For CSS strings (the @page footer): no quotes, backslashes or newlines.
const cssText = (s: string) => s.replace(/["\\\n\r]/g, " ");

/** Every source URL cited in the sections, in first-cited order. */
function sourcesIn(sections: Section[]): { url: string; host: string }[] {
  const seen = new Set<string>();
  const out: { url: string; host: string }[] = [];
  for (const s of sections) {
    for (const m of s.content.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
      const url = m[0].replace(/[.,;:]+$/, "");
      if (seen.has(url)) continue;
      seen.add(url);
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep the raw text */ }
      out.push({ url, host });
    }
  }
  return out;
}

const RISK_COLORS: Record<string, string> = {
  high: "#e53e3e",
  medium: "#ff6b2b",
  low: "#38a169",
};

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: run } = await supabase
    .from("deep_dives")
    .select("*")
    .eq("id", id)
    .single();

  if (!run) notFound();

  const bundle = run.bundle as DeepDiveBundle;
  const sections = bundle?.sections ?? [];
  const generatedDate = new Date(bundle.generatedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  const sources = sourcesIn(sections);
  // Page footer on every page after the cover: what this is, when it was
  // generated, and page N of M (CSS @page margin boxes; Chrome's Save as PDF).
  const pageFooter = cssText(`Metis Deep Dive · ${bundle.company} · Generated ${generatedDate}`);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{bundle.company} — Deep Dive · Metis</title>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Inter', sans-serif; background: #fff; color: #111; }
          @page {
            margin: 0.75in; size: letter;
            @bottom-left { content: "${pageFooter}"; font: 8pt 'JetBrains Mono', monospace; color: #888; }
            @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt 'JetBrains Mono', monospace; color: #888; }
          }
          @page :first { @bottom-left { content: none; } @bottom-right { content: none; } }
          @media print {
            .no-print { display: none !important; }
            .section { page-break-inside: avoid; }
            .cover { page-break-after: always; min-height: auto; padding: 60px 0; }
          }
          .doc { max-width: 680px; margin: 0 auto; padding: 48px; }
          .print-btn { 
            position: fixed; top: 20px; right: 20px;
            padding: 10px 20px; background: #ff6b2b; color: white;
            border: none; border-radius: 6px; font-family: 'Space Grotesk', sans-serif;
            font-size: 13px; font-weight: 600; cursor: pointer;
          }
          .cover { padding: 80px 0 60px; border-bottom: 3px solid #ff6b2b; margin-bottom: 60px; }
          .cover-brand { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.2em; color: #ff6b2b; margin-bottom: 24px; text-transform: uppercase; }
          .cover-type { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.14em; color: #999; margin-bottom: 14px; text-transform: uppercase; }
          .cover-company { font-family: 'Space Grotesk', sans-serif; font-size: 48px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; color: #111; margin-bottom: 32px; }
          .cover-divider { width: 100%; height: 1px; background: #e8e8e8; margin-bottom: 24px; }
          .cover-meta { font-size: 13px; color: #666; margin-bottom: 14px; }
          .cover-disclaimer { font-size: 11px; color: #bbb; line-height: 1.6; max-width: 460px; }
          .section { margin-bottom: 48px; padding-bottom: 48px; border-bottom: 1px solid #f0f0f0; }
          .section:last-of-type { border-bottom: none; }
          .section-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
          .section-num { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #ff6b2b; letter-spacing: 0.1em; flex-shrink: 0; }
          .section-title { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 600; color: #111; flex: 1; }
          .risk-badge { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; padding: 3px 8px; border-radius: 4px; border: 1px solid; flex-shrink: 0; text-transform: uppercase; }
          .section-content { font-size: 13.5px; line-height: 1.85; color: #333; }
          .section-content p { margin-bottom: 12px; }
          .section-content p:last-child { margin-bottom: 0; }
          .placeholder { color: #999; font-style: italic; }
          .appendix { margin-top: 48px; page-break-before: always; }
          .appendix h2 { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 600; margin-bottom: 6px; }
          .appendix p { font-size: 12px; color: #666; margin-bottom: 16px; }
          .appendix ol { padding-left: 20px; font-size: 11px; line-height: 1.7; color: #333; }
          .appendix a { color: #333; word-break: break-all; }
          .appendix .host { font-family: 'JetBrains Mono', monospace; color: #999; margin-right: 6px; }
          .doc-footer { margin-top: 60px; padding-top: 16px; border-top: 1px solid #e8e8e8; display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #bbb; letter-spacing: 0.04em; }
        `}</style>
      </head>
      <body>
        <PrintButton />

        <div className="doc">
          <div className="cover">
            <div className="cover-brand">METIS</div>
            <div className="cover-type">Deep Dive Analysis</div>
            <div className="cover-company">{bundle.company}</div>
            <div className="cover-divider" />
            <div className="cover-meta">Generated {generatedDate} · {sections.length} sections</div>
            <div className="cover-disclaimer">
              This report was generated by Metis, an AI-powered business intelligence platform.
              Information is sourced from public data and should be independently verified before use in financial or strategic decisions.
              {" "}{REPORT_DISCLAIMER}
            </div>
          </div>

          {sections.map((section, i) => (
            <div key={i} className="section">
              <div className="section-header">
                <span className="section-num">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="section-title">{section.title}</h2>
                {section.riskLevel && (
                  <span
                    className="risk-badge"
                    style={{ color: RISK_COLORS[section.riskLevel] ?? "#666", borderColor: RISK_COLORS[section.riskLevel] ?? "#666" }}
                  >
                    {section.riskLevel} Risk
                  </span>
                )}
              </div>
              <div className="section-content">
                {section.content.startsWith("_")
                  ? <p className="placeholder">{section.content.replace(/^_|_$/g, "")}</p>
                  : section.content.split("\n").filter(p => p.trim()).map((para, j) => (
                      <p key={j}>{para}</p>
                    ))
                }
              </div>
            </div>
          ))}

          {sources.length > 0 && (
            <div className="appendix">
              <h2>Sources</h2>
              <p>Every source cited above, in the order it first appears. Retrieved when the report was generated on {generatedDate}.</p>
              <ol>
                {sources.map((s) => (
                  <li key={s.url}><span className="host">{s.host}</span><a href={s.url}>{s.url}</a></li>
                ))}
              </ol>
            </div>
          )}

          <div className="doc-footer">
            <span>Generated by Metis · {generatedDate}</span>
            <span>metisanalytic.com</span>
          </div>

          <div className="no-print">
            <ReportIssueForm
              runId={id}
              reportKind="deep-dive"
              entityName={bundle.company}
              sectionTitles={sections.map((s) => s.title)}
            />
          </div>
        </div>
      </body>
    </html>
  );
}
