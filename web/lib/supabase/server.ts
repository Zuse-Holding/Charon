import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for API routes and server components.
 * Reads auth cookies automatically — no manual token passing needed.
 *
 * `rememberMe: false` drops the auth cookie's Max-Age (session cookie,
 * cleared on browser close) — same behavior/reasoning as
 * web/lib/supabase/client.ts's browser client, needed here now that
 * task 3.1 moved sign-in behind web/app/api/auth/signin/route.ts instead
 * of calling supabase.auth.signInWithPassword() directly from the browser.
 */
export async function createServerSupabaseClient(opts?: { rememberMe?: boolean }) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                opts?.rememberMe === false ? { ...options, maxAge: undefined } : options
              )
            );
          } catch {
            // Server component — cookie setting is handled by middleware
          }
        },
      },
    }
  );
}

/**
 * Service-role client for admin operations (writing research results
 * from the VPS agent server, bypassing RLS).
 * NEVER expose this key to the browser.
 */
export function createServiceClient() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
