import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizePersonName } from "../entities/normalize.js";

/**
 * Self-exclusion list (Feature 6). Subscribers add their own identifiers;
 * once ownership is checked, those identifiers are skipped by automated
 * expansion for every user of the platform, and a direct search on one
 * gets a neutral "not available".
 *
 *   email      confirmed by a link sent to that address
 *   phone      confirmed by an SMS code (Twilio Verify)
 *   name_dob   name plus date of birth; confirmed by a link sent to the
 *              subscriber's own account email, with their statement that
 *              it is them
 *
 * Identifiers are stored only as HMAC-SHA256 with a server-side key
 * (EXCLUSION_HASH_KEY). A plain hash of a phone number or a birth date can
 * be reversed by trying every value; a keyed one can't without the key.
 */

export type ExclusionKind = "email" | "phone" | "name_dob";

export interface Identifier {
  kind: ExclusionKind;
  /** Canonical form. Held in memory only, never stored. */
  canonical: string;
}

export const LIMIT_INDIVIDUAL = 5;
export const LIMIT_TEAM = 25;
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
/** Wording for a search on an excluded identifier. Deliberately the same
 *  as any other unavailable search, so it reveals nothing. */
export const NOT_AVAILABLE = "This search isn't available.";

export function limitFor(tier: string): number {
  return tier === "team" || tier === "internal" ? LIMIT_TEAM : LIMIT_INDIVIDUAL;
}

// --- Canonical forms ---

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string | undefined {
  const v = raw.trim().toLowerCase();
  return EMAIL.test(v) && v.length <= 254 ? v : undefined;
}

/** E.164. Ten digits are read as a US/Canada number. */
export function normalizePhone(raw: string): string | undefined {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** YYYY-MM-DD from "1984-03-07", "3/7/1984" (US order) or "March 7, 1984". */
export function normalizeDob(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [m, d, y] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
    const idx = MONTHS.findIndex((name) => name.startsWith(match![1].slice(0, 3)) && match![1].length >= 3);
    if (idx < 0) return undefined;
    [y, m, d] = [+match[3], idx + 1, +match[2]];
  } else return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  if (y < 1900 || date.getTime() > Date.now()) return undefined;
  return date.toISOString().slice(0, 10);
}

export function normalizeNameDob(name: string, dob: string): string | undefined {
  const n = normalizePersonName(name);
  const d = normalizeDob(dob);
  return n.split(" ").length >= 2 && d ? `${n}|${d}` : undefined;
}

export function canonicalize(kind: ExclusionKind, value: string | { name: string; dob: string }): Identifier | undefined {
  let canonical: string | undefined;
  if (kind === "email" && typeof value === "string") canonical = normalizeEmail(value);
  else if (kind === "phone" && typeof value === "string") canonical = normalizePhone(value);
  else if (kind === "name_dob" && typeof value === "object") canonical = normalizeNameDob(value.name, value.dob);
  return canonical ? { kind, canonical } : undefined;
}

// --- Hashing ---

export function hashKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.EXCLUSION_HASH_KEY;
  if (!key || key.length < 32) throw new Error("EXCLUSION_HASH_KEY is not set (32+ characters)");
  return key;
}

export function hashIdentifier(id: Identifier, key: string): string {
  return createHmac("sha256", key).update(`${id.kind}:${id.canonical}`).digest("hex");
}

/** Enough for the owner to tell entries apart, not enough to recover them. */
export function hintFor(id: Identifier): string {
  if (id.kind === "email") {
    const [local, domain] = id.canonical.split("@");
    return `${local[0]}•••@${domain[0]}•••`;
  }
  if (id.kind === "phone") return `•••• ${id.canonical.slice(-2)}`;
  const [name] = id.canonical.split("|");
  return `${name.split(" ").map((w) => w[0].toUpperCase()).join(". ")}. · date of birth`;
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256Hex(token) };
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- Finding identifiers in a search ---

const EMAIL_IN_TEXT = /[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[a-z]{2,}/gi;
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{8,}\d/g;
const DATE_IN_TEXT = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\b/g;

/** Every identifier a free-text search contains: emails, phone numbers,
 *  and a name with a date of birth. */
export function identifiersInQuery(query: string): Identifier[] {
  const out: Identifier[] = [];
  const emails = query.match(EMAIL_IN_TEXT) ?? [];
  for (const e of emails) {
    const id = canonicalize("email", e);
    if (id) out.push(id);
  }
  const withoutEmails = emails.reduce((q, e) => q.replace(e, " "), query);
  for (const p of withoutEmails.match(PHONE_IN_TEXT) ?? []) {
    if (DATE_IN_TEXT.test(p)) { DATE_IN_TEXT.lastIndex = 0; continue; }
    const id = canonicalize("phone", p);
    if (id) out.push(id);
  }
  for (const dm of withoutEmails.matchAll(DATE_IN_TEXT)) {
    const name = withoutEmails.replace(dm[0], " ").replace(/\b(born|dob|d\.o\.b\.?|b\.)\b/gi, " ").replace(/[^\p{L}\s'-]/gu, " ");
    const id = canonicalize("name_dob", { name, dob: dm[1] });
    if (id) out.push(id);
  }
  return out;
}

// --- Storage and the add / verify / remove flow ---

export interface EntryRow {
  id: string;
  ownerUserId: string;
  kind: ExclusionKind;
  identifierHash: string;
  hint: string;
  status: "pending" | "active";
  verifyTokenHash?: string | null;
  verifyExpiresAt?: string | null;
  verifyAttempts: number;
  createdAt: string;
  activatedAt?: string | null;
}

export interface ExclusionStore {
  listForOwner(ownerUserId: string): Promise<EntryRow[]>;
  insert(row: Omit<EntryRow, "id" | "createdAt">): Promise<EntryRow>;
  update(id: string, patch: Partial<EntryRow>): Promise<void>;
  remove(id: string, ownerUserId: string): Promise<boolean>;
  findByTokenHash(tokenHash: string): Promise<EntryRow | undefined>;
  deleteExpiredPending(ownerUserId: string, now: Date): Promise<void>;
  /** Which of these hashes are active on anyone's list. */
  activeAmong(hashes: string[]): Promise<Set<string>>;
}

export interface Messenger {
  /** Sends the confirmation link; returns false if it couldn't. */
  sendLink(to: string, kind: ExclusionKind, link: string): Promise<boolean>;
  startSms(phone: string): Promise<boolean>;
  checkSms(phone: string, code: string): Promise<boolean>;
}

export type AddInput =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "name_dob"; value: { name: string; dob: string }; attest: boolean };

export type AddResult =
  | { ok: true; entry: PublicEntry; next: "check_email" | "enter_code" | "check_account_email" }
  | { ok: false; error: string };

export interface PublicEntry {
  id: string;
  kind: ExclusionKind;
  hint: string;
  status: "pending" | "active";
  createdAt: string;
  activatedAt?: string | null;
}

const toPublic = (r: EntryRow): PublicEntry =>
  ({ id: r.id, kind: r.kind, hint: r.hint, status: r.status, createdAt: r.createdAt, activatedAt: r.activatedAt ?? null });

export class ExclusionService {
  constructor(
    private store: ExclusionStore,
    private messenger: Messenger,
    private key: string,
    /** Builds the confirmation link for a token. */
    private linkFor: (token: string) => string,
    private now: () => Date = () => new Date(),
  ) {}

  async list(owner: string): Promise<PublicEntry[]> {
    await this.store.deleteExpiredPending(owner, this.now());
    return (await this.store.listForOwner(owner)).map(toPublic);
  }

  async add(owner: string, accountEmail: string | undefined, tier: string, input: AddInput): Promise<AddResult> {
    const id = canonicalize(input.kind, input.value as never);
    if (!id) {
      return { ok: false, error: input.kind === "email" ? "That doesn't look like an email address."
        : input.kind === "phone" ? "Enter the number with its country code, e.g. +1 415 555 0100."
        : "Enter a full name and a valid date of birth." };
    }
    if (input.kind === "name_dob" && !input.attest) return { ok: false, error: "Confirm that this name and date of birth are yours." };
    if (input.kind === "name_dob" && !accountEmail) return { ok: false, error: "Your account has no email address to confirm with." };

    const now = this.now();
    await this.store.deleteExpiredPending(owner, now);
    const existing = await this.store.listForOwner(owner);
    const hash = hashIdentifier(id, this.key);
    if (existing.some((e) => e.identifierHash === hash)) return { ok: false, error: "That's already on your list." };
    const limit = limitFor(tier);
    if (existing.length >= limit) return { ok: false, error: `Your plan allows ${limit} entries. Remove one to add another.` };

    const expires = new Date(now.getTime() + VERIFY_TTL_MS).toISOString();
    if (input.kind === "phone") {
      const entry = await this.store.insert({
        ownerUserId: owner, kind: "phone", identifierHash: hash, hint: hintFor(id), status: "pending",
        verifyTokenHash: null, verifyExpiresAt: expires, verifyAttempts: 0, activatedAt: null,
      });
      if (!(await this.messenger.startSms(id.canonical))) {
        await this.store.remove(entry.id, owner);
        return { ok: false, error: "We couldn't send a code to that number. Check it and try again." };
      }
      return { ok: true, entry: toPublic(entry), next: "enter_code" };
    }

    const { token, hash: tokenHash } = newToken();
    const entry = await this.store.insert({
      ownerUserId: owner, kind: input.kind, identifierHash: hash, hint: hintFor(id), status: "pending",
      verifyTokenHash: tokenHash, verifyExpiresAt: expires, verifyAttempts: 0, activatedAt: null,
    });
    const to = input.kind === "email" ? id.canonical : accountEmail!;
    if (!(await this.messenger.sendLink(to, input.kind, this.linkFor(token)))) {
      await this.store.remove(entry.id, owner);
      return { ok: false, error: "We couldn't send the confirmation email. Try again in a few minutes." };
    }
    return { ok: true, entry: toPublic(entry), next: input.kind === "email" ? "check_email" : "check_account_email" };
  }

  /** The confirmation link. The token is the only credential. */
  async confirmLink(token: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const entry = await this.store.findByTokenHash(sha256Hex(token));
    if (!entry || entry.status !== "pending" || !entry.verifyExpiresAt || Date.parse(entry.verifyExpiresAt) < this.now().getTime()) return false;
    await this.store.update(entry.id, { status: "active", activatedAt: this.now().toISOString(), verifyTokenHash: null, verifyExpiresAt: null });
    return true;
  }

  /** The SMS code. The number is sent again (it isn't stored) and must
   *  hash to the pending entry. */
  async confirmCode(owner: string, entryId: string, phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
    const id = canonicalize("phone", phone);
    const entry = (await this.store.listForOwner(owner)).find((e) => e.id === entryId);
    if (!entry || entry.kind !== "phone" || entry.status !== "pending") return { ok: false, error: "That entry isn't waiting for a code." };
    if (!entry.verifyExpiresAt || Date.parse(entry.verifyExpiresAt) < this.now().getTime()) return { ok: false, error: "That code has expired. Remove the entry and add it again." };
    if (entry.verifyAttempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "Too many attempts. Remove the entry and add it again." };
    if (!id || !sameHash(hashIdentifier(id, this.key), entry.identifierHash)) return { ok: false, error: "That number doesn't match the one you added." };
    if (!/^\d{4,10}$/.test(code.trim())) return { ok: false, error: "Enter the code from the text message." };
    await this.store.update(entry.id, { verifyAttempts: entry.verifyAttempts + 1 });
    if (!(await this.messenger.checkSms(id.canonical, code.trim()))) return { ok: false, error: "That code didn't work. Check the text and try again." };
    await this.store.update(entry.id, { status: "active", activatedAt: this.now().toISOString(), verifyExpiresAt: null });
    return { ok: true };
  }

  /** One click, immediate. */
  async remove(owner: string, entryId: string): Promise<boolean> {
    return this.store.remove(entryId, owner);
  }
}

/** For searches and expansion: is any of these identifiers excluded? */
export class ExclusionGuard {
  constructor(private store: Pick<ExclusionStore, "activeAmong">, private key: string) {}

  async excluded(ids: Identifier[]): Promise<boolean> {
    if (ids.length === 0) return false;
    const hashes = ids.map((i) => hashIdentifier(i, this.key));
    return (await this.store.activeAmong(hashes)).size > 0;
  }

  /** Free-text search: true when it names an excluded identifier. */
  async blocksQuery(query: string): Promise<boolean> {
    return this.excluded(identifiersInQuery(query));
  }

  /** Expansion (Feature 4): the identifiers that may be followed. */
  async followable(ids: Identifier[]): Promise<Identifier[]> {
    if (ids.length === 0) return [];
    const hashes = ids.map((i) => hashIdentifier(i, this.key));
    const active = await this.store.activeAmong(hashes);
    return ids.filter((_, i) => !active.has(hashes[i]));
  }
}
