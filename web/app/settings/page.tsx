"use client";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { useTier } from "../../lib/tier-context";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

// Internal accounts show "Charon" here (Charon Protocol) rather than the
// raw tier name — this is the one place that designator surfaces at all,
// since the sidebar badge deliberately hides it for internal accounts.
const PLAN_LABEL: Record<string, string> = {
  internal: "Charon",
  team: "Team",
  pro: "Pro",
  basic: "Basic",
  free: "Free",
  trial: "Trial",
};

// Show/hide toggle for password fields — plain SVG eye / eye-off icons,
// no icon library dependency for one small control.
function PasswordToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={styles.pwToggle}
      onClick={onToggle}
      tabIndex={-1}
      aria-label={show ? "Hide password" : "Show password"}
    >
      {show ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M1 1l22 22" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

export default function Settings() {
  const { displayName, updateDisplayName, tier, monthlyUsage } = useTier();
  const [email, setEmail]           = useState<string>("");
  const [resetSent, setResetSent]   = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [nameInput, setNameInput]   = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved]   = useState(false);
  const [nameError, setNameError]   = useState<string | null>(null);

  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwSaved, setPwSaved]       = useState(false);
  const [pwError, setPwError]       = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword]         = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    });
  }, []);

  // Seed the input once the context has resolved the current name —
  // guarded so it doesn't stomp on what the user is actively typing.
  useEffect(() => {
    if (displayName && !nameInput) setNameInput(displayName);
  }, [displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveName() {
    setNameSaving(true);
    setNameSaved(false);
    setNameError(null);
    const { ok, error } = await updateDisplayName(nameInput.trim());
    setNameSaving(false);
    if (ok) {
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } else {
      setNameError(error ?? "Save failed — please try again.");
    }
  }

  async function handlePasswordReset() {
    if (!email) return;
    setResetLoading(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setResetSent(true);
    setResetLoading(false);
  }

  async function handlePasswordUpdate() {
    setPwError(null);
    setPwSaved(false);
    if (newPassword.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setPwError("Passwords don't match."); return; }
    setPwSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) { setPwError(error.message); return; }
    setPwSaved(true);
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(() => setPwSaved(false), 2500);
  }

  const SYSTEM_INFO = [
    { section: "INTELLIGENCE ENGINE", items: [
      { label: "LLM Provider",    value: "Groq · llama-3.3-70b-versatile", status: "active" },
      { label: "KG Extraction",   value: "OpenRouter · gpt-oss-120b",       status: "active" },
      { label: "Search Provider", value: "Serper.dev",                       status: "active" },
      { label: "Agent Pipeline",  value: "7 parallel agents",                status: "" },
      { label: "Full Page Fetch", value: "Enabled",                          status: "active" },
    ]},
    { section: "DATA", items: [
      { label: "Storage",         value: "Supabase (cloud)",     status: "active" },
      { label: "Auth",            value: "Supabase Auth",        status: "active" },
      { label: "Knowledge Graph", value: "Phase 1 — collecting", status: "active" },
    ]},
    { section: "ACCOUNT", items: [
      { label: "Email", value: email || "Loading...",                    status: "" },
      { label: "Plan",  value: tier ? (PLAN_LABEL[tier] ?? tier) : "—",  status: "active" },
    ]},
  ];

  // Only Basic (or any tier with a monthlyResearchLimit set server-side)
  // gets a usage row — Pro/Team/internal come back with monthlyUsage: null
  // since they're unlimited, so this section just doesn't render for them.
  const usagePct = monthlyUsage ? Math.min(100, Math.round((monthlyUsage.used / monthlyUsage.limit) * 100)) : 0;
  const usageStatus = usagePct >= 100 ? "danger" : usagePct >= 80 ? "warn" : "active";
  const resetsLabel = monthlyUsage
    ? new Date(monthlyUsage.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>
            System configuration and account information for your Metis workspace.
          </p>

          <div className={styles.group}>
            <div className={styles.groupLabel}>PROFILE</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Display Name</span>
              <input
                className={styles.nameInput}
                type="text"
                placeholder={email ? email.split("@")[0] : "Your name"}
                value={nameInput}
                maxLength={60}
                onChange={(e) => { setNameInput(e.target.value); setNameSaved(false); setNameError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
              />
              <button
                className={styles.resetBtn}
                onClick={handleSaveName}
                disabled={nameSaving}
              >
                {nameSaved ? "✓ Saved" : nameSaving ? "Saving..." : "Save"}
              </button>
            </div>
            {nameError && <div className={styles.fieldError}>{nameError}</div>}
          </div>

          {SYSTEM_INFO.map((group) => (
            <div key={group.section} className={styles.group}>
              <div className={styles.groupLabel}>{group.section}</div>
              {group.items.map((item) => (
                <div key={item.label} className={styles.row}>
                  <span className={styles.rowLabel}>{item.label}</span>
                  <span className={styles.rowValue}>{item.value}</span>
                  {item.status && (
                    <span className={`${styles.badge} ${styles[item.status]}`}>
                      {item.status.toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
              {group.section === "ACCOUNT" && monthlyUsage && (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Quick Profiles</span>
                  <div className={styles.usageRow}>
                    <div className={styles.usageBarTrack}>
                      <div
                        className={`${styles.usageBarFill} ${usageStatus !== "active" ? styles[usageStatus] : ""}`}
                        style={{ width: `${usagePct}%` }}
                      />
                    </div>
                    <span className={styles.usageCount}>
                      {monthlyUsage.used}/{monthlyUsage.limit} · resets {resetsLabel}
                    </span>
                  </div>
                  <span className={`${styles.badge} ${styles[usageStatus]}`}>
                    {usageStatus === "danger" ? "LIMIT REACHED" : usageStatus === "warn" ? "NEAR LIMIT" : "OK"}
                  </span>
                </div>
              )}
            </div>
          ))}

          <div className={styles.group}>
            <div className={styles.groupLabel}>SECURITY</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>New Password</span>
              <div className={styles.pwWrap}>
                <input
                  className={`${styles.nameInput} ${styles.pwInput}`}
                  type={showNewPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setPwError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handlePasswordUpdate()}
                />
                <PasswordToggle show={showNewPassword} onToggle={() => setShowNewPassword((v) => !v)} />
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Confirm Password</span>
              <div className={styles.pwWrap}>
                <input
                  className={`${styles.nameInput} ${styles.pwInput}`}
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setPwError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handlePasswordUpdate()}
                />
                <PasswordToggle show={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} />
              </div>
              <button
                className={styles.resetBtn}
                onClick={handlePasswordUpdate}
                disabled={pwSaving || !newPassword || !confirmPassword}
              >
                {pwSaved ? "✓ Updated" : pwSaving ? "Saving..." : "Update Password"}
              </button>
            </div>
            {pwError && <div className={styles.fieldError}>{pwError}</div>}

            <button
              className={styles.emailResetLink}
              onClick={handlePasswordReset}
              disabled={resetLoading || resetSent}
            >
              {resetSent ? "✓ Reset email sent" : resetLoading ? "Sending..." : "Or send a reset link to your email instead"}
            </button>
          </div>

          <div className={styles.group}>
            <div className={styles.groupLabel}>UPGRADE</div>
            <div className={styles.upgradeCard}>
              <div className={styles.upgradeText}>
                Unlock Deep Dive, Knowledge Graph, and unlimited watchlist tracking with Pro.
              </div>
              <a href="mailto:support@metisanalytic.com?subject=Metis Pro Upgrade" className={styles.upgradeBtn}>
                Contact us to upgrade →
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
