import "server-only";

// Read-only Stripe revenue, split by Metis product. Plain REST (no SDK),
// GET requests only. Use a *restricted* key with read access to
// Subscriptions, Invoices, Charges and Products — nothing that can create
// a charge, refund or payout:
//   STRIPE_RESTRICTED_KEY=rk_live_...
//
// A Stripe product maps to a Metis product by its metadata
// `metis_product` (intelligence | diligence | committee) or, failing that,
// by its name containing one of those words. Anything else is "other".

export type ProductKey = "intelligence" | "diligence" | "committee" | "other";
export const PRODUCT_KEYS: ProductKey[] = ["intelligence", "diligence", "committee", "other"];

const API = "https://api.stripe.com/v1";
const PAGE_CAP = 5; // 500 rows per list is plenty at this stage

interface StripeList<T> { data: T[]; has_more: boolean }
interface Price { product: string; unit_amount: number | null; recurring: { interval: string; interval_count: number } | null }
interface SubItem { price: Price; quantity?: number }
interface Subscription { id: string; items: { data: SubItem[] } }
interface InvoiceLine { amount: number; price: { product: string } | null }
interface Invoice { id: string; lines: { data: InvoiceLine[] } }
interface Charge { amount: number; amount_refunded: number; paid: boolean; invoice: string | null }
interface Product { id: string; name: string; metadata: Record<string, string> }

async function get<T>(path: string, params: Record<string, string> | URLSearchParams, key: string): Promise<T> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    // Pinned to match agents/stripe_api.py, so invoice line shapes don't
    // shift when the account's default API version moves.
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Stripe ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function listAll<T extends { id?: string }>(path: string, params: Record<string, string>, key: string): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < PAGE_CAP; page++) {
    const res = await get<StripeList<T>>(path, { ...params, limit: "100", ...(after ? { starting_after: after } : {}) }, key);
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    after = res.data[res.data.length - 1].id;
  }
  return out;
}

export function productKeyFor(p: Product | undefined): ProductKey {
  if (!p) return "other";
  const tagged = p.metadata?.metis_product?.toLowerCase();
  if (tagged === "intelligence" || tagged === "diligence" || tagged === "committee") return tagged;
  const name = p.name.toLowerCase();
  if (name.includes("diligence")) return "diligence";
  if (name.includes("committee")) return "committee";
  if (name.includes("intelligence")) return "intelligence";
  return "other";
}

// Monthly value of one subscription item, in cents. Before discounts/tax.
export function monthlyCents(item: SubItem): number {
  const { unit_amount, recurring } = item.price;
  if (!unit_amount || !recurring) return 0;
  const qty = item.quantity ?? 1;
  const perInterval = unit_amount * qty;
  const n = recurring.interval_count || 1;
  switch (recurring.interval) {
    case "day": return (perInterval * 30.4375) / n;
    case "week": return (perInterval * 52) / 12 / n;
    case "month": return perInterval / n;
    case "year": return perInterval / 12 / n;
    default: return 0;
  }
}

export interface Revenue {
  mrr: Record<ProductKey, number>;          // dollars
  last30: Record<ProductKey, number>;       // dollars collected via paid invoices
  oneOff30: number;                         // dollars from charges with no invoice
  subscriptions: Record<ProductKey, number>;
}

function zero(): Record<ProductKey, number> {
  return { intelligence: 0, diligence: 0, committee: 0, other: 0 };
}

export async function fetchRevenue(key: string): Promise<Revenue> {
  const since = String(Math.floor(Date.now() / 1000) - 30 * 86_400);
  const [subs, invoices, charges] = await Promise.all([
    listAll<Subscription>("/subscriptions", { status: "active" }, key),
    listAll<Invoice>("/invoices", { status: "paid", "created[gte]": since }, key),
    listAll<Charge & { id: string }>("/charges", { "created[gte]": since }, key),
  ]);

  const productIds = new Set<string>();
  subs.forEach((s) => s.items.data.forEach((i) => productIds.add(i.price.product)));
  invoices.forEach((inv) => inv.lines.data.forEach((l) => l.price && productIds.add(l.price.product)));
  const products = new Map<string, Product>();
  const ids = [...productIds];
  for (let i = 0; i < ids.length; i += 100) {
    const params = new URLSearchParams({ limit: "100" });
    ids.slice(i, i + 100).forEach((id) => params.append("ids[]", id));
    const res = await get<StripeList<Product>>("/products", params, key);
    res.data.forEach((p) => products.set(p.id, p));
  }

  const mrr = zero();
  const subscriptions = zero();
  for (const s of subs) {
    const keys = new Set<ProductKey>();
    for (const item of s.items.data) {
      const k = productKeyFor(products.get(item.price.product));
      mrr[k] += monthlyCents(item) / 100;
      keys.add(k);
    }
    keys.forEach((k) => (subscriptions[k] += 1));
  }

  const last30 = zero();
  for (const inv of invoices) {
    for (const line of inv.lines.data) {
      last30[productKeyFor(line.price ? products.get(line.price.product) : undefined)] += line.amount / 100;
    }
  }

  const oneOff30 = charges
    .filter((c) => c.paid && !c.invoice)
    .reduce((sum, c) => sum + (c.amount - c.amount_refunded) / 100, 0);

  return { mrr, last30, oneOff30, subscriptions };
}
