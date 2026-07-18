import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Server-only client — service role key. Bypasses RLS, same posture as the
// agent (agents/selene.py). Only ever imported from app/api/** route handlers
// or server components — `server-only` throws a build error if a client
// component tries to pull this in.
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
