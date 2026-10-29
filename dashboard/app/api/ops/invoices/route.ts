import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Draft an invoice from the Invoices tab. This never talks to Stripe: it
// puts a pending send_invoice row in the approval queue, same path as
// anything Selene proposes. Approving it there is what sends it
// (agents/executor.py). Limits mirror the executor's, which re-checks
// everything anyway.

export const dynamic = "force-dynamic";

const PRODUCTS = ["intelligence", "diligence", "committee"];
const PRODUCT_LABEL: Record<string, string> = {
  intelligence: "Metis Intelligence", diligence: "Metis Diligence", committee: "Committee",
};
const EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
const MAX_ITEMS = 20;
const MAX_TOTAL = 250_000;

class Invalid extends Error {}

interface ItemIn { description?: unknown; amount?: unknown; quantity?: unknown }

function items(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Invalid("Add at least one line.");
  if (raw.length > MAX_ITEMS) throw new Invalid(`Keep it to ${MAX_ITEMS} lines.`);
  return (raw as ItemIn[]).map((it, i) => {
    const description = typeof it.description === "string" ? it.description.trim() : "";
    const amount = Math.round(Number(it.amount) * 100) / 100;
    const quantity = it.quantity == null || it.quantity === "" ? 1 : Number(it.quantity);
    if (!description || description.length > 300) throw new Invalid(`Line ${i + 1} needs a description.`);
    if (!Number.isFinite(amount) || amount <= 0) throw new Invalid(`Line ${i + 1} needs an amount above zero.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Invalid(`Line ${i + 1}: quantity must be 1–1000.`);
    return { description, amount, quantity };
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const db = createServiceClient();
    const product = String(body.product ?? "");
    if (!PRODUCTS.includes(product)) throw new Invalid("Pick which product this is for.");
    const lines = items(body.items);
    const total = lines.reduce((sum, l) => sum + l.amount * l.quantity, 0);
    if (total > MAX_TOTAL) throw new Invalid(`That's over $${MAX_TOTAL.toLocaleString()}. Do this one by hand in Stripe.`);
    const days = body.days_until_due == null || body.days_until_due === "" ? 30 : Number(body.days_until_due);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Invalid("Due in 1–90 days.");
    const memo = typeof body.memo === "string" && body.memo.trim() ? body.memo.trim().slice(0, 500) : null;

    // Lead-linked invoices bill the lead's own address (the executor
    // enforces this too); otherwise the typed email has to be valid.
    let email = typeof body.customer_email === "string" ? body.customer_email.trim() : "";
    let name = typeof body.customer_name === "string" ? body.customer_name.trim().slice(0, 200) : "";
    const leadId = typeof body.lead_id === "string" && body.lead_id ? body.lead_id : null;
    if (leadId) {
      const { data: lead } = await db.from("leads").select("email, name").eq("id", leadId).single();
      if (!lead?.email) throw new Invalid("That lead has no email on file.");
      email = lead.email;
      name = name || lead.name || "";
    }
    if (!EMAIL_RE.test(email)) throw new Invalid("Enter the customer's email.");

    const who = name || email;
    const { data, error } = await db.from("approval_queue").insert({
      module: "finance",
      action_type: "send_invoice",
      summary: `Invoice ${who} $${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${PRODUCT_LABEL[product]}`,
      payload: { customer_email: email, customer_name: name || null, product, items: lines, days_until_due: days, memo },
      related_lead: leadId,
    }).select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data?.[0] });
  } catch (e) {
    if (e instanceof Invalid) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
