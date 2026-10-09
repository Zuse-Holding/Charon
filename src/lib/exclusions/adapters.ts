import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "../email/send.js";
import { ExclusionGuard, hashKey, type EntryRow, type ExclusionKind, type ExclusionStore, type Messenger } from "./index.js";

/** exclusion_entries in Supabase (service role only; see schema.sql). */
export class SupabaseExclusionStore implements ExclusionStore {
  constructor(private db: SupabaseClient) {}

  private static row(r: Record<string, unknown>): EntryRow {
    return {
      id: r.id as string, ownerUserId: r.owner_user_id as string, kind: r.kind as ExclusionKind,
      identifierHash: r.identifier_hash as string, hint: r.hint as string, status: r.status as EntryRow["status"],
      verifyTokenHash: r.verify_token_hash as string | null, verifyExpiresAt: r.verify_expires_at as string | null,
      verifyAttempts: r.verify_attempts as number, createdAt: r.created_at as string, activatedAt: r.activated_at as string | null,
    };
  }

  async listForOwner(owner: string) {
    const { data, error } = await this.db.from("exclusion_entries").select("*").eq("owner_user_id", owner).order("created_at");
    if (error) throw error;
    return (data ?? []).map(SupabaseExclusionStore.row);
  }

  async insert(row: Omit<EntryRow, "id" | "createdAt">) {
    const { data, error } = await this.db.from("exclusion_entries").insert({
      owner_user_id: row.ownerUserId, kind: row.kind, identifier_hash: row.identifierHash, hint: row.hint, status: row.status,
      verify_token_hash: row.verifyTokenHash ?? null, verify_expires_at: row.verifyExpiresAt ?? null,
      verify_attempts: row.verifyAttempts, activated_at: row.activatedAt ?? null,
    }).select("*").single();
    if (error) throw error;
    return SupabaseExclusionStore.row(data);
  }

  async update(id: string, patch: Partial<EntryRow>) {
    const cols: Record<string, unknown> = {};
    if (patch.status !== undefined) cols.status = patch.status;
    if (patch.activatedAt !== undefined) cols.activated_at = patch.activatedAt;
    if (patch.verifyTokenHash !== undefined) cols.verify_token_hash = patch.verifyTokenHash;
    if (patch.verifyExpiresAt !== undefined) cols.verify_expires_at = patch.verifyExpiresAt;
    if (patch.verifyAttempts !== undefined) cols.verify_attempts = patch.verifyAttempts;
    const { error } = await this.db.from("exclusion_entries").update(cols).eq("id", id);
    if (error) throw error;
  }

  async remove(id: string, owner: string) {
    const { data, error } = await this.db.from("exclusion_entries").delete().eq("id", id).eq("owner_user_id", owner).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async findByTokenHash(tokenHash: string) {
    const { data, error } = await this.db.from("exclusion_entries").select("*").eq("verify_token_hash", tokenHash).limit(1);
    if (error) throw error;
    return data?.[0] ? SupabaseExclusionStore.row(data[0]) : undefined;
  }

  async deleteExpiredPending(owner: string, now: Date) {
    const { error } = await this.db.from("exclusion_entries").delete()
      .eq("owner_user_id", owner).eq("status", "pending").lt("verify_expires_at", now.toISOString());
    if (error) throw error;
  }

  async activeAmong(hashes: string[]) {
    if (hashes.length === 0) return new Set<string>();
    const { data, error } = await this.db.from("exclusion_entries").select("identifier_hash")
      .eq("status", "active").in("identifier_hash", hashes);
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.identifier_hash as string));
  }
}

/** Confirmation email (Resend, via sendEmail) and SMS codes (Twilio Verify). */
export class LiveMessenger implements Messenger {
  constructor(private env: Record<string, string | undefined> = process.env) {}

  async sendLink(to: string, kind: ExclusionKind, link: string) {
    const what = kind === "email" ? "this email address" : "your name and date of birth";
    const { sent } = await sendEmail({
      to,
      redactRecipient: true,
      subject: "Confirm your Metis exclusion",
      text: [
        `Someone (we hope you) asked Metis to exclude ${what} from automated research.`,
        ``,
        `Confirm it here within 24 hours:`,
        link,
        ``,
        `Once confirmed, Metis won't follow ${what} when it expands research, for any user. You can remove it any time from your account.`,
        ``,
        `If this wasn't you, ignore this email and nothing changes.`,
      ].join("\n"),
    });
    return sent;
  }

  smsAvailable() {
    return !!(this.env.TWILIO_ACCOUNT_SID && this.env.TWILIO_AUTH_TOKEN && this.env.TWILIO_VERIFY_SERVICE_SID);
  }

  private twilio(path: string, body: Record<string, string>): Promise<Response> | undefined {
    const sid = this.env.TWILIO_ACCOUNT_SID, token = this.env.TWILIO_AUTH_TOKEN, service = this.env.TWILIO_VERIFY_SERVICE_SID;
    if (!sid || !token || !service) {
      console.warn("[exclusions] Twilio isn't configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)");
      return undefined;
    }
    return fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async startSms(phone: string) {
    try {
      const res = await this.twilio("Verifications", { To: phone, Channel: "sms" });
      if (!res) return false;
      if (!res.ok) console.error(`[exclusions] Twilio Verify start failed: HTTP ${res.status}`);
      return res.ok;
    } catch (err) {
      console.error("[exclusions] Twilio Verify start threw:", err instanceof Error ? err.message : err);
      return false;
    }
  }

  async checkSms(phone: string, code: string) {
    try {
      const res = await this.twilio("VerificationCheck", { To: phone, Code: code });
      if (!res || !res.ok) return false;
      const data = (await res.json()) as { status?: string };
      return data.status === "approved";
    } catch (err) {
      console.error("[exclusions] Twilio Verify check threw:", err instanceof Error ? err.message : err);
      return false;
    }
  }
}

let envGuard: ExclusionGuard | null | undefined;

/** The guard with the service-role client and key from the environment;
 *  undefined (and logged once) when either is missing. */
export function guardFromEnv(env: Record<string, string | undefined> = process.env): ExclusionGuard | undefined {
  if (envGuard !== undefined) return envGuard ?? undefined;
  try {
    const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase credentials missing");
    envGuard = new ExclusionGuard(new SupabaseExclusionStore(createClient(url, key)), hashKey(env));
  } catch (err) {
    console.error("[exclusions] guard unavailable, expansion won't check the list:", err instanceof Error ? err.message : err);
    envGuard = null;
  }
  return envGuard ?? undefined;
}
