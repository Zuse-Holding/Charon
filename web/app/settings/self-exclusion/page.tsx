"use client";
import { useEffect, useState } from "react";
import Sidebar from "../../../components/Sidebar";
import Topbar from "../../../components/Topbar";
import { isEnabled } from "../../../lib/flags";
import base from "../page.module.css";
import styles from "./page.module.css";

/**
 * Self-exclusion list (Feature 6). Identifiers added here, once confirmed,
 * are skipped by Metis's automated expansion for every user, and a direct
 * search on one returns a neutral "not available".
 */

type Kind = "email" | "phone" | "name_dob";

interface Entry {
  id: string;
  kind: Kind;
  hint: string;
  status: "pending" | "active";
  createdAt: string;
}

const KIND_LABEL: Record<Kind, string> = { email: "Email", phone: "Phone", name_dob: "Name and date of birth" };

export default function SelfExclusion() {
  const enabled = isEnabled("self_exclusion");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>("email");
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  // phone entry awaiting its code: the number is kept only in this page's memory
  const [codeFor, setCodeFor] = useState<{ id: string; phone: string } | null>(null);
  const [code, setCode] = useState("");

  async function load() {
    const res = await fetch("/api/exclusions");
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries ?? []);
      setLimit(data.limit ?? 5);
    }
    setLoading(false);
  }

  useEffect(() => { if (enabled) load(); else setLoading(false); }, [enabled]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/exclusions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, value: kind === "name_dob" ? { name, dob } : value, attest }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ text: data.error ?? "That didn't go through. Try again.", error: true });
      return;
    }
    if (data.next === "enter_code") {
      setCodeFor({ id: data.entry.id, phone: value });
      setMessage({ text: "We texted you a code. Enter it below." });
    } else if (data.next === "check_email") {
      setMessage({ text: "Check that inbox for a confirmation link. It takes effect once you confirm." });
    } else {
      setMessage({ text: "Check your account email for a confirmation link. It takes effect once you confirm." });
    }
    setValue(""); setName(""); setDob(""); setAttest(false);
    load();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!codeFor) return;
    setBusy(true);
    const res = await fetch(`/api/exclusions/${codeFor.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: codeFor.phone, code }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage({ text: data.error ?? "That code didn't work.", error: true });
      return;
    }
    setCodeFor(null);
    setCode("");
    setMessage({ text: "Confirmed. Your number is excluded." });
    load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/exclusions/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEntries((prev) => prev.filter((x) => x.id !== id));
      if (codeFor?.id === id) setCodeFor(null);
    } else {
      setMessage({ text: "Couldn't remove that. Try again.", error: true });
    }
  }

  return (
    <div className={base.shell}>
      <Sidebar />
      <main className={base.main}>
        <Topbar />
        <div className={base.content}>
          <h1 className={base.title}>Self-exclusion</h1>
          <p className={base.sub}>
            Add your own email, phone number, or name with date of birth. Once you confirm it&apos;s yours, Metis won&apos;t
            follow it when expanding research, for anyone on the platform, and a direct search for it shows &quot;not available&quot;.
            We store only a scrambled form, never the identifier itself.
          </p>

          {!enabled ? (
            <div className={base.row}>Self-exclusion isn&apos;t available yet.</div>
          ) : (
            <>
              <div className={base.group}>
                <div className={base.groupLabel}>YOUR LIST · <span className={styles.mono}>{entries.length}/{limit}</span></div>
                {loading ? (
                  <div className={base.row}>Loading…</div>
                ) : entries.length === 0 ? (
                  <div className={base.row}>Nothing excluded yet.</div>
                ) : (
                  entries.map((x) => (
                    <div key={x.id} className={base.row}>
                      <div className={styles.entry}>
                        <span className={styles.kind}>{KIND_LABEL[x.kind]}</span>
                        <span className={styles.mono}>{x.hint}</span>
                        <span className={x.status === "active" ? styles.active : styles.pending}>
                          {x.status === "active" ? "✓ Excluded" : "… Waiting for confirmation"}
                        </span>
                      </div>
                      <button type="button" className={styles.remove} onClick={() => remove(x.id)}>Remove</button>
                    </div>
                  ))
                )}
              </div>

              {codeFor && (
                <form className={base.group} onSubmit={submitCode}>
                  <div className={base.groupLabel}>ENTER YOUR CODE</div>
                  <div className={styles.form}>
                    <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                      value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code from the text message" />
                    <button type="submit" className={styles.primary} disabled={busy || !code}>Confirm number</button>
                  </div>
                </form>
              )}

              {entries.length < limit && (
                <form className={base.group} onSubmit={add}>
                  <div className={base.groupLabel}>ADD AN IDENTIFIER</div>
                  <div className={styles.kinds} role="radiogroup" aria-label="Type">
                    {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={kind === k}
                        className={kind === k ? styles.kindOn : styles.kindOff} onClick={() => setKind(k)}>
                        {KIND_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  <div className={styles.form}>
                    {kind === "name_dob" ? (
                      <>
                        <input className={styles.input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
                        <input className={styles.input} type="date" value={dob} onChange={(e) => setDob(e.target.value)} aria-label="Date of birth" />
                        <label className={styles.attest}>
                          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
                          This is my own name and date of birth.
                        </label>
                      </>
                    ) : (
                      <input className={styles.input} type={kind === "email" ? "email" : "tel"}
                        placeholder={kind === "email" ? "you@example.com" : "+1 415 555 0100"}
                        value={value} onChange={(e) => setValue(e.target.value)} aria-label={KIND_LABEL[kind]} />
                    )}
                    <button type="submit" className={styles.primary} disabled={busy}>
                      {kind === "phone" ? "Text me a code" : "Send confirmation link"}
                    </button>
                  </div>
                </form>
              )}

              {message && <p className={message.error ? styles.error : styles.note} role="status">{message.text}</p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
