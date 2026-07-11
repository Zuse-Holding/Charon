"use client";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { useTier } from "../../lib/tier-context";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

export default function Settings() {
  const { displayName, updateDisplayName } = useTier();
  const [email, setEmail]           = useState<string>("");
  const [resetSent, setResetSent]   = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [nameInput, setNameInput]   = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved]   = useState(false);

  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwSaved, setPwSaved]       = useState(false);
  const [pwError, setPwError]       = useState<string | null>(null);

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
    const ok = await updateDisplayName(nameInput.trim());
    setNameSaving(false);
    if (ok) {
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
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
      { label: "Email", value: email || "Loading...", status: "" },
      { label: "Plan",  value: "Basic",               status: "active" },
    ]},
  ];

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>
            System configuration and account information for your Charon workspace.
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
                onChange={(e) => { setNameInput(e.target.value); setNameSaved(false); }}
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
            </div>
          ))}

          <div className={styles.group}>
            <div className={styles.groupLabel}>SECURITY</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>New Password</span>
              <input
                className={styles.nameInput}
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handlePasswordUpdate()}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Confirm Password</span>
              <input
                className={styles.nameInput}
                type="password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setPwError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handlePasswordUpdate()}
              />
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
              <a href="mailto:hello@zuseholdings.com?subject=Charon Pro Upgrade" className={styles.upgradeBtn}>
                Contact us to upgrade →
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
