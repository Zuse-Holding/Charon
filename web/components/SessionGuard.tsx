"use client";
import { useEffect } from "react";
import { isPrivatePath } from "../lib/return-to";

/**
 * L4: when a session expires mid-task, the next API call gets a 401 (see
 * middleware.ts). Instead of a broken page, send the person to sign in with
 * `next` set to exactly where they were, query string included. Only on
 * private pages: a public page's API call may 401 for a visitor who was
 * never signed in, and they shouldn't be bounced to /login.
 */
export function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;
    window.fetch = async (input, init) => {
      const res = await original(input, init);
      if (res.status !== 401 || redirecting || !isPrivatePath(window.location.pathname)) return res;
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
        redirecting = true;
        const back = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?expired=1&next=${encodeURIComponent(back)}`);
      }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);
  return null;
}
