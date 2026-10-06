"""
SELENE OS — approval-gate configuration
Single source of truth shared by:
  - agents/mcp_tools.py  (validates propose_action's action_type)
  - agents/selene.py     (builds --allowedTools per job)

Keeping this in one tiny module means the tool server and the orchestrator
can never drift out of sync on what's irreversible or what each job may
touch — CLAUDE.md non-negotiable #1: enforce structurally, not just via
prompt instructions.
"""

from __future__ import annotations

# Actions that change something outside our own database: send a message,
# move money, touch a lead's status/contact history. Every one of these is
# only ever *created* by propose_action, as a pending row — never executed
# by any agent tool. agents/executor.py carries out a row only after Nick
# approves it on the dashboard; it's cron-run plain code the model can't
# reach. No agent tool performs the action itself.
IRREVERSIBLE_ACTIONS = {"send_email", "add_ledger_entry", "contact_lead", "update_lead_status", "send_invoice"}

# Tool names (bare, i.e. without the mcp__selene-tools__ prefix Claude Code
# adds) each job may call. Deny-by-default: a job gets nothing not listed
# here. No job gets a Gmail tool: agents/gmail.py fetches mail in plain
# Python (read-only token) and hands it to the model as untrusted data in
# the prompt. Sending lives in agents/gmail_send.py, reachable only from
# agents/executor.py after Nick approves.
JOB_ALLOWLISTS: dict[str, set[str]] = {
    "inbox":      {"record_triage", "propose_action", "flag_lead", "delegate_to_charon", "remember_fact"},
    "finance":    {"propose_action", "remember_fact"},
    "enrichment": {"delegate_to_charon", "save_enrichment", "propose_action"},
    "brief":      {"read_ops_data", "save_brief", "remember_fact"},
    # "compliance" runs no model at all — see run_compliance() in selene.py
}

# Every tool agents/mcp_tools.py actually exposes. Used by tests to assert
# no JOB_ALLOWLISTS entry references a tool that doesn't exist, and that no
# tool name in IRREVERSIBLE_ACTIONS is ever directly callable (only
# propose_action's payload may *contain* one of those action_type values).
ALL_TOOLS = {
    "propose_action", "record_triage", "save_enrichment", "remember_fact",
    "read_ops_data", "save_brief", "delegate_to_charon", "flag_lead",
}
