import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { TradeRow, TradeStatus } from "@/lib/supabase/types";

// Trading Bots venture — pulls recent orders from each configured Alpaca
// account and upserts them into `trades` (source='alpaca'). Server-only:
// uses the service role client since RLS only allows client-side inserts
// with source='manual' (schema.sql "manual trades" policy) — same posture
// as the agent (agents/selene.py) and the Selene chat route.
//
// Each bot is its own Alpaca account (separate key pairs, confirmed by
// Nick — not one account shared by three bots), so this loops over
// ALPACA_BOT_1_*, ALPACA_BOT_2_*, ... until it hits a gap. Add a 4th bot
// by adding ALPACA_BOT_4_NAME/_KEY_ID/_SECRET — no code change needed.
//
// Defaults to the paper-trading endpoint per bot. Set ALPACA_BOT_N_BASE_URL
// (or the global ALPACA_BASE_URL fallback) to https://api.alpaca.markets
// for a bot trading a live account.
//
// No bots configured? Returns { connected: false, error } with a 200, not
// a 500 — "no keys set" is expected until they're added, not a server
// error. The dashboard renders that as a plain "not connected" panel.

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";

interface BotConfig {
  name: string;
  keyId: string;
  secret: string;
  baseUrl: string;
}

function loadBotConfigs(): BotConfig[] {
  const bots: BotConfig[] = [];
  for (let n = 1; ; n++) {
    const keyId = process.env[`ALPACA_BOT_${n}_KEY_ID`];
    const secret = process.env[`ALPACA_BOT_${n}_SECRET`];
    if (!keyId || !secret) break; // stop at the first gap
    const name = process.env[`ALPACA_BOT_${n}_NAME`] || `Bot ${n}`;
    const baseUrl = process.env[`ALPACA_BOT_${n}_BASE_URL`] || DEFAULT_BASE_URL;
    bots.push({ name, keyId, secret, baseUrl });
  }
  return bots;
}

interface AlpacaOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  filled_at: string | null;
  status: string;
}

interface AlpacaAccount {
  equity: string;
  buying_power: string;
  cash: string;
}

async function alpacaFetch<T>(bot: BotConfig, path: string): Promise<T> {
  const res = await fetch(`${bot.baseUrl}${path}`, {
    headers: { "APCA-API-KEY-ID": bot.keyId, "APCA-API-SECRET-KEY": bot.secret },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`${bot.name}: ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function mapStatus(alpacaStatus: string): TradeStatus {
  if (alpacaStatus === "filled") return "filled";
  if (["canceled", "expired", "rejected"].includes(alpacaStatus)) return "canceled";
  return "open";
}

interface BotResult {
  name: string;
  account: { equity: number; buyingPower: number; cash: number } | null;
  error: string | null;
}

export async function GET() {
  const bots = loadBotConfigs();
  if (bots.length === 0) {
    return NextResponse.json({
      connected: false,
      error: "No bots configured — set ALPACA_BOT_1_NAME / _KEY_ID / _SECRET (and _2, _3, ...) on the server.",
    });
  }

  const supabase = createServiceClient();
  const results: BotResult[] = [];

  for (const bot of bots) {
    try {
      const [account, orders] = await Promise.all([
        alpacaFetch<AlpacaAccount>(bot, "/v2/account"),
        alpacaFetch<AlpacaOrder[]>(bot, "/v2/orders?status=all&limit=50&direction=desc"),
      ]);

      // Upsert by Alpaca order id — select-then-write instead of a DB-level
      // ON CONFLICT since `trades.external_id` has no unique constraint;
      // keeps this idempotent (CLAUDE.md non-negotiable #2) without another
      // migration. Order ids are Alpaca-generated UUIDs, unique across
      // accounts, so a shared external_id lookup is safe across bots too.
      for (const o of orders) {
        const filledQty = Number(o.filled_qty);
        const row = {
          venture: "trading" as const,
          symbol: o.symbol,
          side: o.side,
          qty: filledQty > 0 ? filledQty : Number(o.qty),
          price: o.filled_avg_price ? Number(o.filled_avg_price) : null,
          filled_at: o.filled_at,
          status: mapStatus(o.status),
          source: "alpaca" as const,
          external_id: o.id,
          bot: bot.name,
        };
        const { data: existing } = await supabase
          .from("trades")
          .select("id")
          .eq("external_id", o.id)
          .maybeSingle();
        if (existing) {
          await supabase.from("trades").update(row).eq("id", existing.id);
        } else {
          await supabase.from("trades").insert(row);
        }
      }

      results.push({
        name: bot.name,
        account: { equity: Number(account.equity), buyingPower: Number(account.buying_power), cash: Number(account.cash) },
        error: null,
      });
    } catch (err) {
      results.push({
        name: bot.name,
        account: null,
        error: err instanceof Error ? err.message : "sync failed",
      });
    }
  }

  const { data: trades } = await supabase
    .from("trades")
    .select("*")
    .eq("venture", "trading")
    .order("filled_at", { ascending: false, nullsFirst: false })
    .limit(50);

  return NextResponse.json({
    connected: true,
    bots: results,
    // Through unknown: newer postgrest-js types resolve this select("*")
    // to a SelectQueryError against the hand-written schema types.
    trades: (trades ?? []) as unknown as TradeRow[],
  });
}
