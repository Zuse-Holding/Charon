"use client";
import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { useTier } from "../../lib/tier-context";
import { SiteNav } from "../../components/marketing/MarketingShell";
import styles from "./page.module.css";

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

const MIN_PASSWORD_LENGTH = 8;

// Rules shown before submit, ticked live as the user types.
function PasswordRules({ id, password }: { id: string; password: string }) {
  const ok = password.length >= MIN_PASSWORD_LENGTH;
  return (
    <div id={id} className={`${styles.pwRules} ${ok ? styles.pwRuleMet : ""}`}>
      <span aria-hidden="true">{ok ? "✓" : "·"}</span> At least {MIN_PASSWORD_LENGTH} characters
    </div>
  );
}

// Shown above the signup form when a pricing CTA sent the visitor here,
// so the plan they picked stays in view. Prices mirror app/pricing.
const PLAN_SUMMARY: Record<"basic" | "pro", { name: string; price: string; includes: string }> = {
  basic: { name: "Basic", price: "$19/mo", includes: "25 quick profiles a month · Markdown export" },
  pro:   { name: "Pro",   price: "$49/mo", includes: "Deep Dives · PDF export · Knowledge Graph" },
};

function LoginPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode]         = useState<"signin" | "signup">("signin");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [message, setMessage]   = useState<string | null>(null);

  // Forgot-password (pre-login) flow — separate from the recovery
  // landing below. This just sends the reset email.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Recovery landing — when a user clicks the link from that email,
  // Supabase parses the URL on load, establishes a temporary session,
  // and fires a PASSWORD_RECOVERY auth event. We catch that here and
  // swap the whole card over to a "set new password" form.
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const router   = useRouter();
  const params   = useSearchParams();
  const next     = params.get("next") ?? "/app";
  const plan     = params.get("plan"); // "basic" | "pro" from a pricing-page CTA — see web/lib/checkout.ts
  const postAuthDestination = plan === "basic" || plan === "pro" ? `/checkout-redirect?plan=${plan}` : next;
  const selectedPlan = plan === "basic" || plan === "pro" ? PLAN_SUMMARY[plan] : null;
  const supabase = useMemo(() => createClient({ rememberMe }), [rememberMe]);
  const { refresh: refreshTier } = useTier();

  useEffect(() => {
    if (params.get("mode") === "signup") setMode("signup");
  }, [params]);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  // Signup/signin go through our own API routes (task 3.1), not the
  // browser Supabase client directly — lets the server rate-limit them by
  // IP, which it can't do for a call it never sees. The session cookie
  // Supabase sets is written by the API route's response and picked up
  // automatically by the shared cookie-based session (@supabase/ssr) —
  // no need to hand it back to the client SDK manually.
  async function handleEmail() {
    if (!email || !password) { setError("Email and password required."); return; }
    if (mode === "signup" && (!firstName.trim() || !lastName.trim())) {
      setError("First and last name required.");
      return;
    }
    if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, firstName: firstName.trim(), lastName: lastName.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Signup failed.");

        // Supabase tells us definitively which state we're in — a session
        // coming back means confirmation wasn't required (or this address
        // was already confirmed), so log them straight in instead of
        // showing a "check your email" message that wouldn't apply. No
        // session means confirmation is genuinely required, so say that
        // plainly rather than hedging with "...or sign in directly if
        // confirmation is disabled," which left people unsure which case
        // they were actually in.
        if (data.hasSession) {
          // TierProvider lives in the root layout and doesn't remount on
          // a client-side navigation, so its tier fetch (which ran once
          // on initial page load, before this session existed) never
          // reruns on its own — the app kept showing stale/default tier
          // data until a hard refresh forced a real remount. Explicitly
          // kicking its refresh() here closes that gap without needing
          // a full reload.
          refreshTier();
          router.push(postAuthDestination);
          router.refresh();
        } else {
          setMessage("Check your email to confirm your account, then sign in.");
        }
      } else {
        const res = await fetch("/api/auth/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, rememberMe }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Sign in failed.");
        refreshTier();
        router.push(postAuthDestination);
        router.refresh();
      }
    } catch (err: unknown) {
      setError((err as Error).message ?? "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(postAuthDestination)}` },
    });
    if (error) { setError(error.message); setLoading(false); }
  }

  async function handleForgotPassword() {
    if (!email) { setError("Enter your email above first."); return; }
    setForgotLoading(true); setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send reset email.");
      setForgotSent(true);
    } catch (err: unknown) {
      setError((err as Error).message ?? "Could not send reset email.");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleSetNewPassword() {
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setRecoveryError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (newPassword !== confirmPassword) { setRecoveryError("Passwords don't match."); return; }
    setRecoveryLoading(true); setRecoveryError(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setRecoveryLoading(false);
    if (error) { setRecoveryError(error.message); return; }
    setRecoveryDone(true);
    refreshTier();
    setTimeout(() => { router.push("/app"); router.refresh(); }, 1500);
  }

  // ── Recovery landing view ──────────────────────────────────────────
  if (recoveryMode) {
    return (
      <>
      <SiteNav />
      <div className={styles.shell}>
        <div className={styles.card}>
          <form onSubmit={e => { e.preventDefault(); handleSetNewPassword(); }} noValidate>
            <div className={styles.fields}>
              <div className={styles.sectionNote}>Set a new password for your account.</div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-password">New password</label>
                <div className={styles.pwWrap}>
                  <input
                    id="new-password"
                    name="new-password"
                    autoComplete="new-password"
                    aria-describedby="new-password-rules"
                    className={`${styles.input} ${styles.pwInput}`}
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                  />
                  <PasswordToggle show={showNewPassword} onToggle={() => setShowNewPassword(v => !v)} />
                </div>
                <PasswordRules id="new-password-rules" password={newPassword} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="confirm-password">Confirm new password</label>
                <div className={styles.pwWrap}>
                  <input
                    id="confirm-password"
                    name="confirm-password"
                    autoComplete="new-password"
                    className={`${styles.input} ${styles.pwInput}`}
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                  />
                  <PasswordToggle show={showConfirmPassword} onToggle={() => setShowConfirmPassword(v => !v)} />
                </div>
              </div>
            </div>

            {recoveryError && <div className={styles.error} role="alert">{recoveryError}</div>}
            {recoveryDone && <div className={styles.success} role="status">Password updated — taking you in...</div>}

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={recoveryLoading || recoveryDone}
            >
              {recoveryLoading ? "Saving…" : "Set new password →"}
            </button>
          </form>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    <SiteNav />
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.tabRow}>
          <button
            className={`${styles.modeTab} ${mode === "signin" ? styles.modeActive : ""}`}
            onClick={() => { setMode("signin"); setError(null); setForgotOpen(false); }}
          >Sign in</button>
          <button
            className={`${styles.modeTab} ${mode === "signup" ? styles.modeActive : ""}`}
            onClick={() => { setMode("signup"); setError(null); setForgotOpen(false); }}
          >Create account</button>
        </div>

        {mode === "signup" && selectedPlan && (
          <div className={styles.planSummary}>
            <div className={styles.planSummaryHead}>
              <span className={styles.planSummaryName}>{selectedPlan.name}</span>
              <span className={styles.planSummaryPrice}>{selectedPlan.price}</span>
            </div>
            <div className={styles.planSummaryIncludes}>{selectedPlan.includes}</div>
            <div className={styles.planSummaryNote}>
              Checkout comes right after you create your account.{" "}
              <a href="/pricing" className={styles.planSummaryLink}>Change plan</a>
            </div>
          </div>
        )}

        <button type="button" className={styles.googleBtn} onClick={handleGoogle} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <div className={styles.divider}><span>or</span></div>

        {forgotOpen ? (
          <form onSubmit={e => { e.preventDefault(); handleForgotPassword(); }} noValidate>
            <div className={styles.fields}>
              <div className={styles.sectionNote}>
                Enter your email and we&apos;ll send you a reset link.
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="forgot-email">Email</label>
                <input
                  id="forgot-email"
                  name="email"
                  autoComplete="email"
                  className={styles.input}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
            </div>

            {error && <div className={styles.error} role="alert">{error}</div>}
            {forgotSent && <div className={styles.success} role="status">Reset email sent — check your inbox.</div>}

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={forgotLoading || forgotSent}
            >
              {forgotLoading ? "Sending…" : forgotSent ? "✓ Email sent" : "Send reset link →"}
            </button>

            <button
              type="button"
              className={styles.backLink}
              onClick={() => { setForgotOpen(false); setForgotSent(false); setError(null); }}
            >← Back to sign in</button>
          </form>
        ) : (
          <form onSubmit={e => { e.preventDefault(); handleEmail(); }} noValidate>
            <div className={styles.fields}>
              {mode === "signup" && (
                <div className={styles.nameRow}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="first-name">First name</label>
                    <input
                      id="first-name"
                      name="given-name"
                      autoComplete="given-name"
                      className={styles.input}
                      type="text"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="last-name">Last name</label>
                    <input
                      id="last-name"
                      name="family-name"
                      autoComplete="family-name"
                      className={styles.input}
                      type="text"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  autoComplete={mode === "signup" ? "email" : "username"}
                  className={styles.input}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">Password</label>
                <div className={styles.pwWrap}>
                  <input
                    id="password"
                    name="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    aria-describedby={mode === "signup" ? "password-rules" : undefined}
                    className={`${styles.input} ${styles.pwInput}`}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                  <PasswordToggle show={showPassword} onToggle={() => setShowPassword(v => !v)} />
                </div>
                {mode === "signup" && <PasswordRules id="password-rules" password={password} />}
              </div>
            </div>

            {mode === "signin" && (
              <div className={styles.optionsRow}>
                <label className={styles.rememberMe}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className={styles.forgotLink}
                  onClick={() => { setForgotOpen(true); setError(null); setMessage(null); }}
                >Forgot password?</button>
              </div>
            )}

            {error   && <div className={styles.error} role="alert">{error}</div>}
            {message && <div className={styles.success} role="status">{message}</div>}

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={loading}
            >
              {loading
                ? (mode === "signin" ? "Signing in…" : "Creating account…")
                : mode === "signin" ? "Sign in →" : "Create account →"}
            </button>
          </form>
        )}
      </div>
    </div>
    </>
  );
}

export default function LoginPageWrapper() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
