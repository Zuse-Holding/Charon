import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Uses the public anon key — safe to expose in the browser.
 * Row Level Security on the database ensures users only see their own data.
 *
 * `rememberMe: false` drops the auth cookie's Max-Age so it becomes a
 * session cookie (cleared when the browser closes) instead of the
 * library's 400-day default — the "Remember me" checkbox on /login.
 */
export function createClient(opts?: { rememberMe?: boolean }) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    opts?.rememberMe === false
      ? { cookieOptions: { maxAge: undefined } }
      : undefined
  );
}
