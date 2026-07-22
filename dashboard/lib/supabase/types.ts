// Hand-written from supabase/schema.sql (Selene OS v1.0). Keep in sync with
// the schema — regenerate with `supabase gen types typescript` once the
// project is live, but the shapes here are authoritative until then.

export type ApprovalModule = "inbox" | "finance" | "leads" | "brief" | "system";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed";
export type Venture = "zuse" | "metis" | "charon" | "lounge" | "kairos" | "personal_mixed";
export type LeadSource = "metis_form" | "inbox" | "manual" | "referral";
export type LeadStatus = "new" | "enriched" | "contacted" | "replied" | "qualified" | "closed" | "dead";
export type DeadlineKind = "state" | "tax" | "domain" | "insurance" | "other";
export type DeadlineStatus = "open" | "done" | "waived";
export type TriageBucket = "lead" | "vendor" | "legal_important" | "personal" | "noise";
export type AgentJob = "inbox" | "finance" | "enrichment" | "compliance" | "brief";
export type AgentRunStatus = "running" | "ok" | "failed";

export interface ApprovalQueueRow {
  id: string;
  created_at: string;
  module: ApprovalModule;
  action_type: string;
  summary: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  resolved_at: string | null;
  executed_at: string | null;
  error: string | null;
  related_lead: string | null;
  related_triage: string | null;
}

export interface LedgerRow {
  id: string;
  created_at: string;
  entry_date: string;
  vendor: string;
  description: string | null;
  amount: number;
  direction: "out" | "in";
  category: string;
  venture: Venture;
  deductible: boolean;
  business_use_pct: number;
  receipt_url: string | null;
  source: "manual" | "email_forward" | "agent";
}

export interface RecurringCostRow {
  id: string;
  vendor: string;
  description: string | null;
  amount: number;
  cadence: "monthly" | "annual" | "usage";
  next_renewal: string | null;
  venture: Venture;
  category: string;
  active: boolean;
}

export interface LeadRow {
  id: string;
  created_at: string;
  source: LeadSource;
  name: string | null;
  email: string | null;
  company: string | null;
  message: string | null;
  status: LeadStatus;
  score: number | null;
  enrichment: Record<string, unknown> | null;
  last_touch_at: string | null;
}

export interface LeadEventRow {
  id: string;
  lead_id: string;
  created_at: string;
  event_type: string;
  detail: string | null;
}

export interface DeadlineRow {
  id: string;
  title: string;
  kind: DeadlineKind;
  due_date: string;
  recurrence: "annual" | "biennial" | "none" | null;
  notes: string | null;
  status: DeadlineStatus;
  completed_at: string | null;
}

export type PersonalGoalStatus = "active" | "done";

export interface PersonalGoalRow {
  id: string;
  created_at: string;
  title: string;
  target_date: string | null;
  notes: string | null;
  status: PersonalGoalStatus;
  completed_at: string | null;
}

export interface InboxTriageRow {
  id: string;
  created_at: string;
  gmail_message_id: string;
  received_at: string | null;
  from_addr: string | null;
  subject: string | null;
  bucket: TriageBucket;
  summary: string | null;
  needs_reply: boolean;
  draft_queued: string | null;
}

export interface BriefRow {
  id: string;
  week_of: string;
  content_md: string;
  stats: Record<string, unknown> | null;
  created_at: string;
}

export interface SeleneFactRow {
  id: string;
  created_at: string;
  fact: string;
  source: string;
  active: boolean;
}

export interface AgentRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  job: AgentJob;
  status: AgentRunStatus;
  cursor_after: string | null;
  actions_proposed: number;
  input_tokens: number | null;
  output_tokens: number | null;
  est_cost_usd: number | null;
  log: string | null;
}

// supabase-js's generic client expects Row/Insert/Update/Relationships per
// table. We don't have a generated schema, so Insert/Update are a relaxed
// Partial<Row> — good enough for the dashboard's own writes (approvals,
// manual ledger, deadline/lead status per schema.sql's RLS policies).
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      approval_queue: Table<ApprovalQueueRow>;
      ledger: Table<LedgerRow>;
      recurring_costs: Table<RecurringCostRow>;
      leads: Table<LeadRow>;
      lead_events: Table<LeadEventRow>;
      deadlines: Table<DeadlineRow>;
      personal_goals: Table<PersonalGoalRow>;
      inbox_triage: Table<InboxTriageRow>;
      briefs: Table<BriefRow>;
      selene_facts: Table<SeleneFactRow>;
      agent_runs: Table<AgentRunRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
