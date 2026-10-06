import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { ContractKind, ContractRow, ContractStatus, MetisProduct, Venture } from "@/lib/supabase/types";

// Contracts tab writes. Service role behind the dashboard login; the anon
// key can only read contracts. Saving a contract fires the
// sync_contract_deadlines trigger (schema.sql), which puts its end and
// notice dates on the compliance clock — no agent involved.

export const dynamic = "force-dynamic";

const KINDS = ["nda", "customer", "vendor", "partner", "contractor", "other"];
const STATUSES = ["draft", "sent", "signed", "expired", "terminated"];
const VENTURES = ["zuse", "metis", "charon", "lounge", "kairos", "personal_mixed", "trading"];
const PRODUCTS = ["intelligence", "diligence", "committee"];
const BILLING = ["one_time", "monthly", "annual"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Input = Partial<ContractRow>;

class Invalid extends Error {}

function text(v: unknown, field: string, max: number, required = false): string | null {
  if (v == null || v === "") {
    if (required) throw new Invalid(`${field} is required.`);
    return null;
  }
  if (typeof v !== "string" || v.length > max) throw new Invalid(`${field} must be text under ${max} characters.`);
  return v.trim();
}

function required(v: unknown, field: string, max: number): string {
  const s = text(v, field, max, true);
  if (!s) throw new Invalid(`${field} is required.`);
  return s;
}

function oneOf(v: unknown, field: string, options: string[], fallback: string | null = null): string | null {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string" || !options.includes(v)) throw new Invalid(`${field} isn't a valid option.`);
  return v;
}

function day(v: unknown, field: string): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v)) throw new Invalid(`${field} must be a date.`);
  return v;
}

function int(v: unknown, field: string, min: number, max: number): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Invalid(`${field} must be a whole number ${min}–${max}.`);
  return n;
}

function clean(c: Input): Partial<ContractRow> {
  const value = c.value_usd == null || (c.value_usd as unknown) === "" ? null : Number(c.value_usd);
  if (value != null && (!Number.isFinite(value) || value < 0)) throw new Invalid("Value must be a positive number.");
  const autoRenews = Boolean(c.auto_renews);
  const venture = oneOf(c.venture, "Venture", VENTURES, "zuse");
  return {
    title: required(c.title, "Title", 200),
    counterparty: required(c.counterparty, "Counterparty", 200),
    kind: oneOf(c.kind, "Kind", KINDS, "other") as ContractKind,
    venture: venture as Venture,
    product: venture === "metis" ? (oneOf(c.product, "Product", PRODUCTS) as MetisProduct | null) : null,
    status: oneOf(c.status, "Status", STATUSES, "draft") as ContractStatus,
    sent_on: day(c.sent_on, "Sent date"),
    signed_on: day(c.signed_on, "Signed date"),
    ends_on: day(c.ends_on, "End date"),
    auto_renews: autoRenews,
    renewal_months: autoRenews ? int(c.renewal_months, "Renewal term", 1, 120) : null,
    notice_days: int(c.notice_days, "Notice days", 0, 365),
    value_usd: value,
    billing: oneOf(c.billing, "Billing", BILLING) as ContractRow["billing"],
    doc_url: text(c.doc_url, "Document link", 1000),
    notes: text(c.notes, "Notes", 2000),
    updated_at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  let body: { contract?: Input };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const input = body.contract;
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Bad request." }, { status: 400 });

  let values;
  try {
    values = clean(input);
  } catch (e) {
    if (e instanceof Invalid) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const db = createServiceClient();
  const query = input.id
    ? db.from("contracts").update(values).eq("id", input.id).select("*")
    : db.from("contracts").insert(values).select("*");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "That contract's gone." }, { status: 404 });
  return NextResponse.json({ row: data[0] });
}
