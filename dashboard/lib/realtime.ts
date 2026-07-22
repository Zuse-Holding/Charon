"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient, type SupabaseBrowserClient } from "./supabase/client";
import type { AgentRunRow, ApprovalQueueRow, LeadRow } from "./supabase/types";

// Centralized realtime — one postgres_changes channel per table, shared
// across every component that cares about it, fanning out in-process.
// Without this, OpsClient + AgentRunStatus (both want agent_runs) and
// ApprovalQueue + AgentRunStatus (both want approval_queue) would each open
// their own duplicate realtime connection to the same table.
//
// Event coverage is deliberately per-table, not "*" everywhere:
//   approval_queue — INSERT (new pending item) + UPDATE (approve/reject/undo)
//   agent_runs     — INSERT (_start_run) + UPDATE (_finish_run)
//   leads          — INSERT + UPDATE (status move) + DELETE (row removed)
// CRUD (select/insert/update) still goes through each component's own
// client via lib/supabase/client.ts — those are plain REST calls and don't
// open extra realtime sockets, so there's no need to route them through here.

type Unsubscribe = () => void;

interface TableEvents<Row> {
  onInsert?: (row: Row) => void;
  onUpdate?: (row: Row) => void;
  onDelete?: (oldRow: Partial<Row>) => void;
}

let sharedClient: SupabaseBrowserClient | null = null;
function client(): SupabaseBrowserClient {
  return sharedClient ?? (sharedClient = createClient());
}

function makeTableHub<Row>(table: string, events: ("INSERT" | "UPDATE" | "DELETE")[]) {
  const insertListeners = new Set<(row: Row) => void>();
  const updateListeners = new Set<(row: Row) => void>();
  const deleteListeners = new Set<(row: Partial<Row>) => void>();
  let channel: RealtimeChannel | null = null;

  function ensureChannel() {
    if (channel) return;
    let builder = client().channel(`${table}_hub`);
    if (events.includes("INSERT")) {
      builder = builder.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        (payload) => insertListeners.forEach((fn) => fn(payload.new as Row))
      );
    }
    if (events.includes("UPDATE")) {
      builder = builder.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table },
        (payload) => updateListeners.forEach((fn) => fn(payload.new as Row))
      );
    }
    if (events.includes("DELETE")) {
      builder = builder.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table },
        (payload) => deleteListeners.forEach((fn) => fn(payload.old as Partial<Row>))
      );
    }
    channel = builder.subscribe();
  }

  function teardownIfIdle() {
    if (channel && insertListeners.size === 0 && updateListeners.size === 0 && deleteListeners.size === 0) {
      client().removeChannel(channel);
      channel = null;
    }
  }

  function subscribe(handlers: TableEvents<Row>): Unsubscribe {
    ensureChannel();
    if (handlers.onInsert) insertListeners.add(handlers.onInsert);
    if (handlers.onUpdate) updateListeners.add(handlers.onUpdate);
    if (handlers.onDelete) deleteListeners.add(handlers.onDelete);
    return () => {
      if (handlers.onInsert) insertListeners.delete(handlers.onInsert);
      if (handlers.onUpdate) updateListeners.delete(handlers.onUpdate);
      if (handlers.onDelete) deleteListeners.delete(handlers.onDelete);
      teardownIfIdle();
    };
  }

  return { subscribe };
}

const approvalQueueHub = makeTableHub<ApprovalQueueRow>("approval_queue", ["INSERT", "UPDATE"]);
const agentRunsHub = makeTableHub<AgentRunRow>("agent_runs", ["INSERT", "UPDATE"]);
const leadsHub = makeTableHub<LeadRow>("leads", ["INSERT", "UPDATE", "DELETE"]);

export function subscribeToApprovalQueue(handlers: TableEvents<ApprovalQueueRow>): Unsubscribe {
  return approvalQueueHub.subscribe(handlers);
}
export function subscribeToAgentRuns(handlers: TableEvents<AgentRunRow>): Unsubscribe {
  return agentRunsHub.subscribe(handlers);
}
export function subscribeToLeads(handlers: TableEvents<LeadRow>): Unsubscribe {
  return leadsHub.subscribe(handlers);
}
