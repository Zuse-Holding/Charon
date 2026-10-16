"use client";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "./Skeleton";
import type { AccountEconomics, PastDueAccount, SaasMetrics } from "../lib/saas-metrics";

interface SpendEntry {
  id: string;
  spent_on: string;
  amount_usd: number;
  channel: string;
  note: string | null;
}

const MONO = "'JetBrains Mono', monospace";
const C = { green: "#34D399", amber: "#E8A020", blue: "#4A90D9", red: "#F87171", muted: "#6B7A99", line: "#1C2333" };

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
// Local calendar date, not toISOString() (UTC), which reads as tomorrow on US evenings.
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const tile = (color: string): React.CSSProperties => ({
  background: "#111827", border: `1px solid ${C.line}`, borderTop: `2px solid ${color}`,
  borderRadius: 10, padding: "14px 18px", flex: "1 1 0", minWidth: 0,
});
const label: React.CSSProperties = {
  fontSize: 11, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6,
};
const value = (color: string): React.CSSProperties => ({
  fontSize: 26, fontWeight: 700, color, lineHeight: 1, fontFamily: MONO, fontVariantNumeric: "tabular-nums",
});
const sub: React.CSSProperties = { fontSize: 11, color: C.muted, marginTop: 5 };
const panelTitle: React.CSSProperties = { ...label, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 12 };
const th: React.CSSProperties = {
  fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted,
  fontWeight: 600, padding: "6px 8px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "7px 8px", borderBottom: `1px solid ${C.line}`, color: "#EDF2F7" };
const num: React.CSSProperties = { textAlign: "right", fontFamily: MONO, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const input: React.CSSProperties = {
  background: "#0E1420", border: `1px solid ${C.line}`, borderRadius: 6, color: "#EDF2F7",
  padding: "7px 9px", fontSize: 12, minWidth: 0,
};

export default function AdminMetrics({ isMobile }: { isMobile: boolean }) {
  const [metrics, setMetrics] = useState<SaasMetrics | null>(null);
  const [recentSpend, setRecentSpend] = useState<SpendEntry[]>([]);
  const [accountEconomics, setAccountEconomics] = useState<AccountEconomics[]>([]);
  const [pastDue, setPastDue] = useState<{ accounts: PastDueAccount[]; mrrAtRiskUsd: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const [form, setForm] = useState({ spentOn: localToday(), amountUsd: "", channel: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/metrics");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMetrics(data.metrics);
      setRecentSpend(data.recentSpend ?? []);
      setAccountEconomics(data.accountEconomics ?? []);
      setPastDue(data.pastDue ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const logSpend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/acquisition-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amountUsd: Number(form.amountUsd) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't log that spend");
      setForm((f) => ({ ...f, amountUsd: "", channel: "", note: "" }));
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't log that spend");
    } finally {
      setSaving(false);
    }
  };

  const m = metrics;
  const days = m?.windowDays ?? 30;
  const show = (v: React.ReactNode) =>
    status === "loading" ? <Skeleton width={72} height={26} /> : status === "error" ? "—" : v;

  const tiles: { key: string; title: string; color: string; val: React.ReactNode; note: string }[] = [
    {
      key: "mrr", title: "MRR", color: C.green,
      val: show(m ? usd(m.mrrUsd) : "—"),
      note: m ? `${m.payingCustomers} paying${m.arpuUsd !== null ? ` · ${usd(m.arpuUsd, 2)} avg` : ""}` : "list price, before discounts",
    },
    {
      key: "cac", title: "CAC", color: C.amber,
      val: show(m?.cacUsd != null ? usd(m.cacUsd, 2) : "—"),
      note: !m ? `last ${days} days`
        : m.acquisitionSpendUsd === 0 ? "log spend below to see this"
        : m.newCustomers === 0 ? `${usd(m.acquisitionSpendUsd)} spent, no new customers yet`
        : `${usd(m.acquisitionSpendUsd)} over ${m.newCustomers} new`,
    },
    {
      key: "margin", title: "Gross margin", color: C.blue,
      val: show(m?.grossMargin != null ? pct(m.grossMargin) : "—"),
      note: m && m.revenueUsd > 0 ? `${usd(m.revenueUsd)} rev · ${usd(m.cogsUsd)} LLM + fees` : `no revenue in the last ${days} days`,
    },
    {
      key: "churn", title: "Churn rate", color: C.red,
      val: show(m?.churnRate != null ? pct(m.churnRate) : "—"),
      note: m && m.customersAtWindowStart > 0
        ? `${m.churnedCustomers} of ${m.customersAtWindowStart} lost, last ${days} days`
        : "not enough history yet",
    },
    {
      key: "ltv", title: "Lifetime value", color: C.green,
      val: show(m?.ltvUsd != null ? usd(m.ltvUsd) : "—"),
      note: m && m.churnRate === 0 ? "no churn yet, so no estimate" : "avg revenue × margin ÷ churn",
    },
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 12, ...(isMobile ? { flexWrap: "wrap" as const } : {}) }}>
        {tiles.map((t) => (
          <div key={t.key} style={{ ...tile(t.color), ...(isMobile ? { flex: "1 1 45%" } : {}) }}>
            <div style={label}>{t.title}</div>
            <div style={value(t.color)}>{t.val}</div>
            <div style={sub}>{status === "error" ? "Couldn't load billing data" : t.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, ...(isMobile ? { flexDirection: "column" as const } : {}) }}>
        <div style={{ ...tile(C.blue), flex: isMobile ? "1 1 auto" : "2 1 0", overflowX: "auto" }}>
          <div style={panelTitle}>Cost vs. price · last {days} days</div>
          {status === "loading" && <Skeleton width="100%" height={60} />}
          {status === "error" && <div style={sub}>Couldn&rsquo;t load billing data</div>}
          {status === "ready" && accountEconomics.length === 0 && (
            <div style={sub}>No reports run in the last {days} days.</div>
          )}
          {status === "ready" && accountEconomics.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Account", "Reports", "LLM cost", "Per report", "Pays / mo", "Margin"].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accountEconomics.map((a, i) => (
                  <tr key={i}>
                    <td style={td}>
                      {a.name}
                      {a.tier && <span style={{ color: C.muted }}> · {a.tier}</span>}
                    </td>
                    <td style={{ ...td, ...num }}>{a.reports}</td>
                    <td style={{ ...td, ...num }}>{usd(a.llmCostUsd, 2)}</td>
                    <td style={{ ...td, ...num }}>{a.costPerReportUsd !== null ? usd(a.costPerReportUsd, 3) : "—"}</td>
                    <td style={{ ...td, ...num }}>{a.monthlyPriceUsd > 0 ? usd(a.monthlyPriceUsd, 2) : "—"}</td>
                    <td style={{ ...td, ...num, color: a.status === "losing_money" ? C.red : a.status === "not_paying" ? C.muted : C.green }}>
                      {a.status === "not_paying" ? "not paying" : usd(a.marginUsd, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {status === "ready" && accountEconomics.some((a) => a.status === "losing_money") && (
            <div style={{ ...sub, color: C.red }}>
              {accountEconomics.filter((a) => a.status === "losing_money").length} paying account(s) cost more in LLM calls than they pay.
            </div>
          )}
        </div>

        <div style={{ ...tile(C.red), flex: isMobile ? "1 1 auto" : "1 1 0" }}>
          <div style={panelTitle}>Past due</div>
          <div style={value(pastDue && pastDue.accounts.length > 0 ? C.red : C.green)}>
            {show(pastDue ? usd(pastDue.mrrAtRiskUsd, 2) : "—")}
          </div>
          <div style={sub}>
            {status !== "ready" || !pastDue ? "monthly revenue at risk"
              : pastDue.accounts.length === 0 ? "Nobody's behind on payment."
              : `monthly revenue at risk · ${pastDue.accounts.length} account(s)`}
          </div>
          {pastDue?.accounts.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.line}`, fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
              <span style={{ color: C.muted }}>{a.status === "unpaid" ? "unpaid" : "past due"}</span>
              <span style={{ fontFamily: MONO, color: C.red }}>{usd(a.monthlyAmountUsd, 2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...tile(C.amber), flex: "0 0 auto" }}>
        <div style={panelTitle}>Acquisition spend</div>
        <form onSubmit={logSpend} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" required aria-label="Date spent" value={form.spentOn}
            max={localToday()}
            onChange={(e) => setForm({ ...form, spentOn: e.target.value })} style={{ ...input, fontFamily: MONO }} />
          <input type="number" required min="0.01" step="0.01" placeholder="Amount (USD)" aria-label="Amount in USD"
            value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })}
            style={{ ...input, fontFamily: MONO, width: 130 }} />
          <input type="text" required maxLength={64} placeholder="Channel, e.g. Google Ads" aria-label="Channel"
            value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} style={{ ...input, width: 190 }} />
          <input type="text" maxLength={280} placeholder="Note (optional)" aria-label="Note"
            value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...input, flex: "1 1 160px" }} />
          <button type="submit" disabled={saving} style={{
            background: C.amber, color: "#080C14", border: "none", borderRadius: 6,
            padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "Logging…" : "Log spend"}
          </button>
        </form>
        {formError && <div role="alert" style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{formError}</div>}

        <div style={{ marginTop: 12 }}>
          {status === "ready" && recentSpend.length === 0 && (
            <div style={{ fontSize: 12, color: C.muted }}>Nothing logged yet. Add ad spend, sponsorships, or anything else you pay to win customers.</div>
          )}
          {recentSpend.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.line}`, fontSize: 12 }}>
              <span style={{ fontFamily: MONO, color: C.muted }}>{s.spent_on}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.channel}{s.note ? <span style={{ color: C.muted }}> · {s.note}</span> : null}
              </span>
              <span style={{ fontFamily: MONO, color: C.amber }}>{usd(Number(s.amount_usd), 2)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
