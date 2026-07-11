"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import styles from "./page.module.css";

export default function LogoutPage() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function doSignOut() {
      await supabase.auth.signOut();
      // Redirect to landing after 2 seconds
      setTimeout(() => router.push("/"), 2000);
    }
    doSignOut();
  }, []);

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.logoMark}>METIS</div>
        <div className={styles.logoSub}>ZUSE HOLDINGS // INTELLIGENCE PLATFORM</div>
        <div className={styles.divider} />
        <div className={styles.icon}>◐</div>
        <div className={styles.title}>You've been signed out</div>
        <div className={styles.sub}>Redirecting you to the home page...</div>
        <button className={styles.btn} onClick={() => router.push("/login")}>
          Sign back in →
        </button>
        <button className={styles.btnSecondary} onClick={() => router.push("/")}>
          Go to home page
        </button>
      </div>
    </div>
  );
}
