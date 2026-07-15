"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { useTier } from "../../lib/tier-context";
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

  const router   = useRouter();
  const params   = useSearchParams();
  const next     = params.get("next") ?? "/app";
  const supabase = createClient();
  const { refresh: refreshTier } = useTier();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEmail() {
    if (!email || !password) { setError("Email and password required."); return; }
    if (mode === "signup" && (!firstName.trim() || !lastName.trim())) {
      setError("First and last name required.");
      return;
    }
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "signup") {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: fullName,
            },
          },
        });
        if (error) throw error;
        // Supabase tells us definitively which state we're in — a session
        // coming back means confirmation wasn't required (or this address
        // was already confirmed), so log them straight in instead of
        // showing a "check your email" message that wouldn't apply. No
        // session means confirmation is genuinely required, so say that
        // plainly rather than hedging with "...or sign in directly if
        // confirmation is disabled," which left people unsure which case
        // they were actually in.
        if (data.session) {
          // TierProvider lives in the root layout and doesn't remount on
          // a client-side navigation, so its tier fetch (which ran once
          // on initial page load, before this session existed) never
          // reruns on its own — the app kept showing stale/default tier
          // data until a hard refresh forced a real remount. Explicitly
          // kicking its refresh() here closes that gap without needing
          // a full reload.
          refreshTier();
          router.push(next);
          router.refresh();
        } else {
          setMessage("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        refreshTier();
        router.push(next);
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
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    if (error) { setError(error.message); setLoading(false); }
  }

  async function handleForgotPassword() {
    if (!email) { setError("Enter your email above first."); return; }
    setForgotLoading(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setForgotLoading(false);
    if (error) { setError(error.message); return; }
    setForgotSent(true);
  }

  async function handleSetNewPassword() {
    if (newPassword.length < 8) { setRecoveryError("Password must be at least 8 characters."); return; }
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
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <div className={styles.logoMark}>METIS</div>
            <div className={styles.logoSub}>ZUSE HOLDINGS // INTELLIGENCE PLATFORM</div>
          </div>

          <div className={styles.fields}>
            <div className={styles.sectionNote}>Set a new password for your account.</div>
            <div className={styles.pwWrap}>
              <input
                className={`${styles.input} ${styles.pwInput}`}
                type={showNewPassword ? "text" : "password"}
                placeholder="New password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSetNewPassword()}
              />
              <PasswordToggle show={showNewPassword} onToggle={() => setShowNewPassword(v => !v)} />
            </div>
            <div className={styles.pwWrap}>
              <input
                className={`${styles.input} ${styles.pwInput}`}
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSetNewPassword()}
              />
              <PasswordToggle show={showConfirmPassword} onToggle={() => setShowConfirmPassword(v => !v)} />
            </div>
          </div>

          {recoveryError && <div className={styles.error}>{recoveryError}</div>}
          {recoveryDone && <div className={styles.success}>Password updated — taking you in...</div>}

          <button
            className={styles.submitBtn}
            onClick={handleSetNewPassword}
            disabled={recoveryLoading || recoveryDone}
          >
            {recoveryLoading ? "..." : "Set New Password →"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>METIS</div>
          <div className={styles.logoSub}>ZUSE HOLDINGS // INTELLIGENCE PLATFORM</div>
        </div>

        <div className={styles.tabRow}>
          <button
            className={`${styles.modeTab} ${mode === "signin" ? styles.modeActive : ""}`}
            onClick={() => { setMode("signin"); setError(null); setForgotOpen(false); }}
          >Sign In</button>
          <button
            className={`${styles.modeTab} ${mode === "signup" ? styles.modeActive : ""}`}
            onClick={() => { setMode("signup"); setError(null); setForgotOpen(false); }}
          >Create Account</button>
        </div>

        <button className={styles.googleBtn} onClick={handleGoogle} disabled={loading}>
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
          <>
            <div className={styles.fields}>
              <div className={styles.sectionNote}>
                Enter your email and we&apos;ll send you a reset link.
              </div>
              <input
                className={styles.input}
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleForgotPassword()}
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}
            {forgotSent && <div className={styles.success}>Reset email sent — check your inbox.</div>}

            <button
              className={styles.submitBtn}
              onClick={handleForgotPassword}
              disabled={forgotLoading || forgotSent}
            >
              {forgotLoading ? "..." : forgotSent ? "✓ Email Sent" : "Send Reset Link →"}
            </button>

            <button
              className={styles.backLink}
              onClick={() => { setForgotOpen(false); setForgotSent(false); setError(null); }}
            >← Back to sign in</button>
          </>
        ) : (
          <>
            <div className={styles.fields}>
              {mode === "signup" && (
                <div className={styles.nameRow}>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="First name"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleEmail()}
                  />
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="Last name"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleEmail()}
                  />
                </div>
              )}
              <input
                className={styles.input}
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleEmail()}
              />
              <div className={styles.pwWrap}>
                <input
                  className={`${styles.input} ${styles.pwInput}`}
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleEmail()}
                />
                <PasswordToggle show={showPassword} onToggle={() => setShowPassword(v => !v)} />
              </div>
            </div>

            {mode === "signin" && (
              <button
                className={styles.forgotLink}
                onClick={() => { setForgotOpen(true); setError(null); setMessage(null); }}
              >Forgot password?</button>
            )}

            {error   && <div className={styles.error}>{error}</div>}
            {message && <div className={styles.success}>{message}</div>}

            <button
              className={styles.submitBtn}
              onClick={handleEmail}
              disabled={loading}
            >
              {loading ? "..." : mode === "signin" ? "Sign In →" : "Create Account →"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPageWrapper() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
