/**
 * CHANGES TO web/app/page.tsx
 *
 * 1. Add deepDiveLoading state near the other useState hooks:
 *
 *   const [deepDiveLoading, setDeepDiveLoading] = useState(false);
 *
 *
 * 2. Add the handleDeepDive function after the confirmDelete function:
 *
 *   async function handleDeepDive() {
 *     if (!selected || deepDiveLoading) return;
 *     setDeepDiveLoading(true);
 *     try {
 *       await fetch("/api/research-deep", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({ subject: selected.subject }),
 *       });
 *       await loadRuns();
 *       const res = await fetch("/api/runs");
 *       if (res.ok) {
 *         const data: Run[] = await res.json();
 *         const deepRun = data.find(
 *           (r) => r.subject === `${selected.subject} [DEEP DIVE]`
 *         );
 *         if (deepRun) await selectRun(deepRun);
 *       }
 *     } finally {
 *       setDeepDiveLoading(false);
 *     }
 *   }
 *
 *
 * 3. In the reportActions div, add this button BEFORE the "Export .md" button:
 *
 *   <button
 *     className={`${styles.actionBtn} ${styles.deepDive}`}
 *     onClick={handleDeepDive}
 *     disabled={deepDiveLoading || loading}
 *     title="Generates an 8-section analyst report (2–5 min)"
 *   >
 *     {deepDiveLoading ? "Analyzing..." : "Deep Dive ⬡"}
 *   </button>
 *
 *
 * 4. Add this CSS to web/app/page.module.css (or wherever reportActions
 *    styles live — check page.module.css):
 *
 *   .deepDive {
 *     background: var(--orange) !important;
 *     color: #000 !important;
 *     border-color: var(--orange) !important;
 *     font-weight: 600;
 *   }
 *   .deepDive:disabled {
 *     background: var(--surface2) !important;
 *     color: var(--muted) !important;
 *     border-color: var(--border) !important;
 *   }
 */

export {};
