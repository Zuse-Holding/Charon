"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import styles from "./page.module.css";

function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode]         = useState<"signin" | "signup">("signin");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [message, setMessage]   = useState<string | null>(null);
  const router   = useRouter();
  const params   = useSearchParams();
  const next     = params.get("next") ?? "/";
  const supabase = createClient();

  async function handleEmail() {
    if (!email || !password) { setError("Email and password required."); return; }
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Check your email to confirm your account, or sign in directly if confirmation is disabled.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
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

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>SELINE INTEL</div>
          <div className={styles.logoSub}>ZUSE HOLDINGS // INTELLIGENCE PLATFORM</div>
        </div>

        <div className={styles.tabRow}>
          <button
            className={`${styles.modeTab} ${mode === "signin" ? styles.modeActive : ""}`}
            onClick={() => { setMode("signin"); setError(null); }}
          >Sign In</button>
          <button
            className={`${styles.modeTab} ${mode === "signup" ? styles.modeActive : ""}`}
            onClick={() => { setMode("signup"); setError(null); }}
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

        <div className={styles.fields}>
          <input
            className={styles.input}
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleEmail()}
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleEmail()}
          />
        </div>

        {error   && <div className={styles.error}>{error}</div>}
        {message && <div className={styles.success}>{message}</div>}

        <button
          className={styles.submitBtn}
          onClick={handleEmail}
          disabled={loading}
        >
          {loading ? "..." : mode === "signin" ? "Sign In →" : "Create Account →"}
        </button>
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