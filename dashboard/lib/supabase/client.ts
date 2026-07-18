"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// Browser client — anon key only. RLS (schema.sql) governs what this can
// read/write: everything readable, writes limited to approvals/manual
// ledger/deadlines/lead status. Never import the service-role key here.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export type SupabaseBrowserClient = ReturnType<typeof createClient>;
