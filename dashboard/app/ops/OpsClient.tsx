"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ops.module.css";
import { subscribeToAgentRuns } from "../../lib/realtime";
import type { AgentJob, AgentRunRow, AgentRunStatus } from "@/lib/supabase/types";
import ApprovalQueue from "./ApprovalQueue";
import SeleneStatusRing from "./AgentRunStatus";
import FinanceView from "./FinanceView";
import DeadlinesView from "./DeadlinesView";
import LeadsView from "./LeadsView";
import PersonalView from "./PersonalView";

// ── Static data (ported from zuse-intel-ops-live-v3.html, wired to schema.sql) ──
//
// bug / deploy / supabase / oaktree / political / kg are pre-existing Metis
// product-ops nodes with no backing table in supabase/schema.sql (Sentry/Vercel
// aren't in this repo's env — see .env.local.example) — left static/untouched.
// inbox / finance / leads / brief are new: they're the real Selene OS modules
// (agents/selene.py JOBS) and are wired to agent_runs below. `formation` is
// repurposed to show the compliance clock (supabase/schema.sql `deadlines`)
// since "Formation / Legal" already meant CA LLC compliance in the original.

type NodeStatus = "warn" | "good" | "bad" | null;

interface NodeDef {
  id: string;
  x: number;
  y: number;
  icon: string;
  label: string;
  sub: string;
  status: NodeStatus;
}

const CORE = { x: 50, y: 44 };

const NODES: NodeDef[] = [
  { id: "bug",       x: 22, y: 18, icon: "🔍", label: "Bug Watcher",       sub: "checking…",    status: null },
  { id: "deploy",    x: 78, y: 18, icon: "✓",        label: "Deploys",           sub: "live",         status: "good" },
  { id: "supabase",  x: 12, y: 50, icon: "📊",  label: "Supabase",          sub: "nominal",      status: null },
  { id: "oaktree",   x: 88, y: 50, icon: "🌳",  label: "Oak Tree",          sub: "NDA pending",  status: "warn" },
  { id: "briefing",  x: 27, y: 80, icon: "📰",  label: "Briefing",          sub: "daily 08:00",  status: null },
  { id: "formation", x: 73, y: 80, icon: "⚖",        label: "Formation",         sub: "in progress",  status: null },
  { id: "political", x: 50, y: 86, icon: "▶",        label: "Political Pipeline", sub: "stubbed",     status: null },
  { id: "inbox",     x: 50, y: 20, icon: "✉",        label: "Inbox",             sub: "no runs yet",  status: null },
  { id: "finance",   x: 18, y: 72, icon: "$",         label: "Finance",           sub: "no runs yet",  status: null },
  { id: "leads",     x: 82, y: 72, icon: "◎",        label: "Leads",             sub: "no runs yet",  status: null },
  { id: "brief",     x: 50, y: 62, icon: "◆",        label: "Weekly Brief",      sub: "no runs yet",  status: null },
];

const NODE_IDS = NODES.map(n => n.id);
const SIDEBAR_NODE_IDS = [...NODE_IDS, "kg"]; // "kg" has a sidebar entry but no canvas node (matches original)

const NODE_COLORS: Record<string, string> = {
  bug: "#ffd24a", deploy: "#30d158", supabase: "#4da3ff",
  oaktree: "#ff9a4d", briefing: "#7ea8ff", formation: "#9fb0c8", political: "#ff7ab8",
  inbox: "#22d3ee", finance: "#4ade80", leads: "#f97316", brief: "#67e8f9",
};
const DEFAULT_PARTICLE_COLOR = "#4de3ff"; // was #ff3b30 pre-Tron-blue swap

// Venture assignment: Zuse Holdings = the parent company's own business
// dealings, exactly what Selene OS (agents/selene.py) runs. Metis Analytics
// = the product and its own ops. Telehealth Platform has no nodes yet —
// every existing node dims out when it's selected, which is correct: there's
// nothing wired to it for now.
const NODE_VENTURE: Record<string, "zuse" | "metis" | "telehealth"> = {
  bug: "metis", deploy: "metis", supabase: "metis", briefing: "metis", political: "metis", kg: "metis",
  oaktree: "zuse", formation: "zuse", inbox: "zuse", finance: "zuse", leads: "zuse", brief: "zuse",
};

// agent_runs.job -> canvas node it lights up.
const JOB_NODE: Record<AgentJob, string> = {
  inbox: "inbox", finance: "finance", enrichment: "leads", compliance: "formation", brief: "brief",
};
const NODE_JOB: Partial<Record<string, AgentJob>> = {
  inbox: "inbox", finance: "finance", leads: "enrichment", brief: "brief",
};
const JOB_LABEL: Record<AgentJob, string> = {
  inbox: "Inbox triage", finance: "Finance sweep", enrichment: "Lead enrichment",
  compliance: "Compliance clock", brief: "Weekly brief",
};

const VIEW_TABS = ["business", "queue", "finance", "deadlines", "leads", "personal", "folders", "team", "usage", "memory"];

interface TermLine { text: string; dim?: boolean; cursor?: boolean; }

const INITIAL_TERMINAL: TermLine[] = [
  { text: "$ selene status" },
  { text: "runner: connected · 1 active", dim: true },
  { text: "strands: 5 · tasks today: 7", dim: true },
  { text: "$", cursor: true },
];

type FeedTone = "ok" | "pending" | "bad" | "neutral";
interface FeedItem { id: number; text: string; ts: string; tone: FeedTone; }

type JobState = { status: AgentRunStatus; at: string } | null;
type NextDeadline = { title: string; dueDate: string; daysOut: number } | null;

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmtTs(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function nowTs() { return fmtTs(new Date().toISOString()); }

// Fixed personal countdowns — pure date math, no Supabase dependency (same
// "compliance clock" philosophy as CLAUDE.md non-negotiable #3: this must
// never break just because a DB call fails).
const UCLA_CONTRACT_END = new Date("2027-06-29T00:00:00");
const MILLION_TARGET = new Date("2027-07-15T00:00:00");

function daysUntil(target: Date): number {
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}
function countdownLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d over`;
  if (days === 0) return "today";
  return `${days}d`;
}

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function describeRun(row: AgentRunRow): { text: string; tone: FeedTone } {
  const label = JOB_LABEL[row.job] ?? row.job;
  if (row.status === "running") return { text: `Selene: ${label} running…`, tone: "neutral" };
  if (row.status === "failed") {
    return { text: `Selene: ${label} failed — ${row.log ? row.log.slice(0, 80) : "check logs"}`, tone: "bad" };
  }
  if (row.actions_proposed > 0) {
    const n = row.actions_proposed;
    return { text: `Selene: ${label} — ${n} thing${n === 1 ? "" : "s"} queued for you`, tone: "pending" };
  }
  return { text: `Selene: ${label} — nothing needed`, tone: "ok" };
}

function bubbleFor(row: AgentRunRow): string | null {
  const label = JOB_LABEL[row.job] ?? row.job;
  if (row.status === "failed") {
    return `${label} run failed. ${row.log ? row.log.slice(0, 140) : "Check the run log when you get a chance."}`;
  }
  if (row.status === "ok" && row.actions_proposed > 0) {
    const n = row.actions_proposed;
    return `Queued ${n} thing${n === 1 ? "" : "s"} from the ${label.toLowerCase()} run. Check the approval queue.`;
  }
  return null;
}

let feedIdSeq = 1;
let bubbleIdSeq = 1;

export default function OpsClient() {
  // ── Layout / nav state ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("business");
  const [activeVenture, setActiveVenture] = useState("zuse");

  // ── Metrics (real data — Supabase; MRR dropped, no Stripe integration yet) ──
  const [leadsToday, setLeadsToday] = useState(0);   // leads created today
  const [tasksToday, setTasksToday] = useState(0);   // agent_runs in last 24h
  const [clock, setClock] = useState("--:--:--");
  const [uptime, setUptime] = useState("00:00:00");

  // ── Canvas / node state ──────────────────────────────────────────────
  const [flaringIds, setFlaringIds] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const [terminal, setTerminal] = useState<TermLine[]>(INITIAL_TERMINAL);
  const [sidebarCounts, setSidebarCounts] = useState<Record<string, number>>(
    Object.fromEntries(SIDEBAR_NODE_IDS.map(id => [id, 0]))
  );
  const [bugSub, setBugSub] = useState("checking…");

  // Selene OS module status, keyed by agent_runs.job — drives inbox/finance/leads/brief nodes.
  const [jobStatus, setJobStatus] = useState<Record<AgentJob, JobState>>({
    inbox: null, finance: null, enrichment: null, compliance: null, brief: null,
  });
  // Compliance clock (deadlines table) — drives the "formation" node.
  const [nextDeadline, setNextDeadline] = useState<NextDeadline>(null);

  // ── Feed / chat ──────────────────────────────────────────────────────
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [bubbles, setBubbles] = useState<{ id: number; text: string; sender: "selene" | "you" }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  // ── Mic ───────────────────────────────────────────────────────────────
  const [micArmed, setMicArmed] = useState(false);

  // ── Refs for imperative bits (drag-pan, SVG particles) ──────────────
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const bgLayerRef = useRef<HTMLDivElement>(null);
  const fieldLayerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  const driftT = useRef(0);

  function getRect() {
    return canvasRef.current?.getBoundingClientRect() ?? { width: 0, height: 0 };
  }
  function getCorePoint() {
    const rect = getRect();
    return { x: (CORE.x / 100) * rect.width, y: (CORE.y / 100) * rect.height };
  }
  function getNodePoint(n: NodeDef) {
    const rect = getRect();
    return { x: (n.x / 100) * rect.width, y: (n.y / 100) * rect.height };
  }

  function drawLines() {
    const cp = getCorePoint();
    setLines(NODES.map(n => {
      const p = getNodePoint(n);
      return { id: n.id, x1: cp.x, y1: cp.y, x2: p.x, y2: p.y, color: NODE_COLORS[n.id] || DEFAULT_PARTICLE_COLOR };
    }));
  }

  function spawnParticle(nodeId: string, colorOverride: string | null, fast: boolean) {
    const node = NODES.find(n => n.id === nodeId);
    const svg = svgRef.current;
    if (!node || !svg) return;

    const cp = getCorePoint();
    const p = getNodePoint(node);
    const color = colorOverride || NODE_COLORS[nodeId] || DEFAULT_PARTICLE_COLOR;
    const dur = fast ? 0.9 + Math.random() * 0.4 : 2.2 + Math.random() * 1.8;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", fast ? "3" : "2");
    circle.setAttribute("fill", color);
    circle.setAttribute("opacity", "0");
    svg.appendChild(circle);

    const anim = document.createElementNS("http://www.w3.org/2000/svg", "animateMotion");
    anim.setAttribute("dur", `${dur}s`);
    anim.setAttribute("repeatCount", "1");
    anim.setAttribute("path", `M ${cp.x} ${cp.y} L ${p.x} ${p.y}`);
    circle.appendChild(anim);

    const fade = document.createElementNS("http://www.w3.org/2000/svg", "animate");
    fade.setAttribute("attributeName", "opacity");
    fade.setAttribute("values", "0;1;1;0");
    fade.setAttribute("keyTimes", "0;0.15;0.8;1");
    fade.setAttribute("dur", `${dur}s`);
    fade.setAttribute("repeatCount", "1");
    circle.appendChild(fade);

    setTimeout(() => circle.remove(), dur * 1000 + 100);
  }

  function flareNode(id: string) {
    if (!NODES.some(n => n.id === id)) return; // e.g. "kg" has no canvas node, matches original's silent no-op
    setFlaringIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setFlaringIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1200);
    spawnParticle(id, "#ffffff", true);
  }

  function addFeedItem(text: string, tone: FeedTone, ts?: string) {
    setFeed(prev => [{ id: feedIdSeq++, text, ts: ts ?? nowTs(), tone }, ...prev].slice(0, 8));
  }

  function addBubble(text: string, sender: "selene" | "you" = "selene") {
    setBubbles(prev => [...prev, { id: bubbleIdSeq++, text, sender }].slice(-4));
  }

  async function sendChatMessage(e: React.FormEvent) {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message || chatSending) return;

    addBubble(message, "you");
    setChatInput("");
    setChatSending(true);
    try {
      const res = await fetch("/api/ops/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      addBubble(res.ok ? data.reply : `Couldn't reach me — ${data.error ?? "something went wrong"}`);
    } catch {
      addBubble("Couldn't reach me — check the server's still running.");
    } finally {
      setChatSending(false);
    }
  }

  function inspectNode(n: NodeDef) {
    setTerminal([
      { text: `$ selene inspect ${n.id}` },
      { text: `module: ${n.label}`, dim: true },
      { text: "status: nominal", dim: true },
      { text: "$", cursor: true },
    ]);
    flareNode(n.id);
  }

  function toggleMic() {
    setMicArmed(prev => {
      const next = !prev;
      if (next) addBubble("Listening. Say the word.");
      return next;
    });
  }

  function requestNewStrand() {
    const name = typeof window !== "undefined" ? window.prompt("Name the new strand:") : null;
    if (!name || !name.trim()) return;
    addFeedItem(`Strand "${name.trim()}" requested — not automated yet, needs manual setup`, "neutral");
  }

  function showRunnerInfo() {
    setTerminal([
      { text: "$ selene runners" },
      { text: "Selene — active, running the daily briefing and intel-feed bug loop", dim: true },
      { text: "1 runner total. No additional agents provisioned.", dim: true },
      { text: "$", cursor: true },
    ]);
  }

  // Resolve dynamic sub-label + status for the nodes backed by real data.
  function wiredNodeVisual(id: string): { sub: string; status: NodeStatus } | null {
    const job = NODE_JOB[id];
    if (job) {
      const js = jobStatus[job];
      if (!js) return { sub: "no runs yet", status: null };
      if (js.status === "running") return { sub: "running…", status: null };
      if (js.status === "failed") return { sub: `failed ${relTime(js.at)}`, status: "bad" };
      return { sub: relTime(js.at), status: "good" };
    }
    if (id === "formation") {
      if (!nextDeadline) return { sub: "no deadlines", status: null };
      const { daysOut, title } = nextDeadline;
      const status: NodeStatus = daysOut <= 7 ? "bad" : daysOut <= 30 ? "warn" : "good";
      const label = title.length > 22 ? title.slice(0, 21) + "…" : title;
      return { sub: `${daysOut}d — ${label}`, status };
    }
    return null;
  }

  // ── Wiring lines: draw on mount + resize ────────────────────────────
  useEffect(() => {
    drawLines();
    window.addEventListener("resize", drawLines);
    return () => window.removeEventListener("resize", drawLines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ambient traveling particles (decorative, not tied to real data) ──
  useEffect(() => {
    const interval = setInterval(() => {
      const id = NODE_IDS[Math.floor(Math.random() * NODE_IDS.length)];
      spawnParticle(id, null, false);
    }, 900);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drag-pan + wheel-pan background ───────────────────────────────────
  // Grabbing (or scrolling) the background pans a much wider range than a
  // small nudge — the point is the illusion of physically moving through
  // the node space, not just a subtle parallax wobble. The grid layer also
  // picks up a slight rotation proportional to how far it's panned, like
  // banking while flying through it; nodes (fieldLayer) stay level so
  // labels stay readable.
  const PAN_LIMIT = 260;

  function applyPan(ox: number, oy: number) {
    ox = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, ox));
    oy = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, oy));
    dragState.current.offsetX = ox;
    dragState.current.offsetY = oy;
    const rotate = (ox / PAN_LIMIT) * 6; // deg, max ±6
    if (bgLayerRef.current) {
      bgLayerRef.current.style.transform = `translate(${ox * 0.5}px, ${oy * 0.5}px) rotate(${rotate}deg)`;
    }
    if (fieldLayerRef.current) fieldLayerRef.current.style.transform = `translate(${ox * 0.18}px, ${oy * 0.18}px)`;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      dragState.current.dragging = true;
      canvas.classList.add(styles.grabbing);
      dragState.current.startX = e.clientX - dragState.current.offsetX;
      dragState.current.startY = e.clientY - dragState.current.offsetY;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current.dragging) return;
      applyPan(e.clientX - dragState.current.startX, e.clientY - dragState.current.startY);
    };
    const onMouseUp = () => {
      dragState.current.dragging = false;
      canvas.classList.remove(styles.grabbing);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyPan(dragState.current.offsetX - e.deltaX * 0.6, dragState.current.offsetY - e.deltaY * 0.6);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // Re-attach whenever the canvas remounts — it's conditionally rendered
    // per activeTab, so switching to another tab and back to "business"
    // creates a brand-new DOM node that a []-deps effect would never
    // re-bind to, silently breaking drag/wheel panning after one tab trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Idle drift when not dragging ─────────────────────────────────────
  // requestAnimationFrame instead of setInterval(50ms): syncs the transform
  // update with the browser's own paint cycle rather than fighting it,
  // which is kinder to compositing and was implicated in the cursor
  // disappearing over this layer (see .canvas's cursor comment in
  // ops.module.css). Wobbles around wherever the last pan settled
  // (dragState.offsetX/Y) instead of around zero, so releasing a drag
  // doesn't snap the view back to center.
  useEffect(() => {
    let frame: number;
    const tick = () => {
      if (!dragState.current.dragging) {
        // Same 0.01-per-50ms pace as before, rescaled for a ~60fps rAF tick.
        driftT.current += 0.0033;
        const { offsetX, offsetY } = dragState.current;
        const dx = offsetX * 0.5 + Math.sin(driftT.current) * 6;
        const dy = offsetY * 0.5 + Math.cos(driftT.current * 0.8) * 4;
        const rotate = (offsetX / PAN_LIMIT) * 6 + Math.sin(driftT.current * 0.6) * 1.2;
        if (bgLayerRef.current) bgLayerRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ── Clock / uptime ───────────────────────────────────────────────────
  useEffect(() => {
    const startTime = Date.now();
    const tick = () => {
      setClock(nowTs());
      const up = Math.floor((Date.now() - startTime) / 1000);
      const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = up % 60;
      setUptime(`${pad(h)}:${pad(m)}:${pad(s)}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Initial real data: agent_runs, leads, deadlines, approval queue ──
  useEffect(() => {
    let cancelled = false;

    fetch("/api/ops/summary", { credentials: "include" })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data || cancelled) return;

        const last24h: AgentRunRow[] = data.agentRuns?.last24h ?? [];
        const last10: AgentRunRow[] = data.agentRuns?.last10 ?? [];
        const latestByJob: Partial<Record<AgentJob, AgentRunRow | null>> = data.agentRuns?.latestByJob ?? {};

        const counts = Object.fromEntries(SIDEBAR_NODE_IDS.map(id => [id, 0])) as Record<string, number>;
        for (const row of last24h) {
          const nodeId = JOB_NODE[row.job];
          if (nodeId && nodeId in counts) counts[nodeId] += 1;
        }
        const bugWatcherOpenCount: number = data.sentryIssues?.bugWatcherOpenCount ?? 0;
        counts.bug = bugWatcherOpenCount;
        setSidebarCounts(counts);
        setBugSub(bugWatcherOpenCount === 0 ? "clear" : `${bugWatcherOpenCount} open`);

        setTasksToday(last24h.length);
        setLeadsToday(data.leadsToday ?? 0);

        setJobStatus(prev => {
          const next = { ...prev };
          (Object.keys(JOB_NODE) as AgentJob[]).forEach(job => {
            const row = latestByJob[job];
            if (row) next[job] = { status: row.status, at: row.finished_at ?? row.started_at };
          });
          return next;
        });

        if (data.nextDeadline) setNextDeadline(data.nextDeadline);

        setFeed(
          last10.map((row: AgentRunRow) => {
            const { text, tone } = describeRun(row);
            return { id: feedIdSeq++, text, ts: fmtTs(row.finished_at ?? row.started_at), tone };
          })
        );
      })
      .catch(() => { /* leave defaults on failure */ });

    addBubble("Hey. Bug Watcher and Daily Briefing are both live. Ping me if you need anything.");

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live updates: Supabase realtime on agent_runs (INSERT = job started, ──
  // UPDATE = job finished — matches _start_run/_finish_run in agents/selene.py) ──
  useEffect(() => {
    return subscribeToAgentRuns({
      onInsert: (row) => {
        const nodeId = JOB_NODE[row.job];
        if (nodeId) {
          flareNode(nodeId);
          setJobStatus(prev => ({ ...prev, [row.job]: { status: "running", at: row.started_at } }));
        }
      },
      onUpdate: (row) => {
        if (!row.finished_at) return; // still running, nothing to report yet

        const { text, tone } = describeRun(row);
        addFeedItem(text, tone, fmtTs(row.finished_at));

        const nodeId = JOB_NODE[row.job];
        if (nodeId) {
          flareNode(nodeId);
          setJobStatus(prev => ({ ...prev, [row.job]: { status: row.status, at: row.finished_at! } }));
          setSidebarCounts(prev => ({ ...prev, [nodeId]: (prev[nodeId] ?? 0) + 1 }));
        }

        const bubbleText = bubbleFor(row);
        if (bubbleText) addBubble(bubbleText);

        setTasksToday(v => v + 1);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metisCount = SIDEBAR_NODE_IDS.filter(id => NODE_VENTURE[id] === "metis").reduce((sum, id) => sum + (sidebarCounts[id] ?? 0), 0);
  const zuseCount = SIDEBAR_NODE_IDS.filter(id => NODE_VENTURE[id] === "zuse").reduce((sum, id) => sum + (sidebarCounts[id] ?? 0), 0);
  const telehealthCount = SIDEBAR_NODE_IDS.filter(id => NODE_VENTURE[id] === "telehealth").reduce((sum, id) => sum + (sidebarCounts[id] ?? 0), 0);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={styles.opsRoot}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logo}>ZUSE<span>::</span>INTEL OPS</div>
          <div className={styles.status}><div className={styles.dot}></div><span className={styles.statusText}> SELENE · CONNECTED</span></div>
          <SeleneStatusRing />
        </div>
        <div className={styles.viewTabs}>
          {VIEW_TABS.map(tab => (
            <div
              key={tab}
              className={`${styles.viewTab} ${activeTab === tab ? styles.active : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.toUpperCase()}
            </div>
          ))}
        </div>
        <div className={styles.metricsBar}>
          <div className={styles.metricMini}><div className={styles.label}>LEADS</div><div className={styles.val}>{leadsToday}</div></div>
          <div className={`${styles.metricMini} ${styles.tasks}`}><div className={styles.label}>TASKS</div><div className={styles.val}>{tasksToday}</div></div>
          <div className={`${styles.metricMini} ${styles.hideOnTiny}`}><div className={styles.label}>UPTIME</div><div className={styles.val}>{uptime}</div></div>
          <div className={`${styles.metricMini} ${styles.time}`}><div className={styles.label}>TIME</div><div className={styles.val}>{clock}</div></div>
          <div className={styles.metricMini} title="UCLA contract ends Jun 29, 2027">
            <div className={styles.label}>UCLA</div>
            <div className={styles.val}>{countdownLabel(daysUntil(UCLA_CONTRACT_END))}</div>
          </div>
          <div className={styles.metricMini} title="Kyle's million-dollar bet — Jul 15, 2027">
            <div className={styles.label}>$1M BET</div>
            <div className={styles.val}>{countdownLabel(daysUntil(MILLION_TARGET))}</div>
          </div>
        </div>
      </div>

      <div className={styles.main}>
        {activeTab === "queue" ? (
          <ApprovalQueue />
        ) : activeTab === "finance" ? (
          <FinanceView />
        ) : activeTab === "deadlines" ? (
          <DeadlinesView />
        ) : activeTab === "leads" ? (
          <LeadsView />
        ) : activeTab === "personal" ? (
          <PersonalView />
        ) : activeTab !== "business" ? (
          <div className={styles.placeholderView}>
            <div className={styles.placeholderTitle}>{activeTab.toUpperCase()}</div>
            <div className={styles.placeholderText}>This view isn&apos;t built yet.</div>
          </div>
        ) : (
        <>
        <div className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Ventures <span>3</span></div>
            <div
              className={`${styles.strand} ${activeVenture === "zuse" ? styles.active : ""}`}
              onClick={() => setActiveVenture("zuse")}
            >
              <div className={styles.name}><span className={styles.icon}>⌘</span>Zuse Holdings</div><span className={styles.count}>{zuseCount}</span>
            </div>
            <div
              className={`${styles.strand} ${activeVenture === "metis" ? styles.active : ""}`}
              onClick={() => setActiveVenture("metis")}
            >
              <div className={styles.name}><span className={styles.icon}>◈</span>Metis Analytics</div><span className={styles.count}>{metisCount}</span>
            </div>
            <div
              className={`${styles.strand} ${activeVenture === "telehealth" ? styles.active : ""}`}
              onClick={() => setActiveVenture("telehealth")}
            >
              <div className={styles.name}><span className={styles.icon}>✚</span>Telehealth Platform</div><span className={styles.count}>{telehealthCount}</span>
            </div>
          </div>
          {activeVenture === "metis" && (
          <>
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Products <span>4</span></div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("bug")}>
              <div className={styles.name}><span className={styles.icon}>➤</span>Bug Watcher</div><span className={styles.count}>{sidebarCounts.bug}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("briefing")}>
              <div className={styles.name}><span className={styles.icon}>◆</span>Daily Briefing</div><span className={styles.count}>{sidebarCounts.briefing}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("political")}>
              <div className={styles.name}><span className={styles.icon}>▶</span>Political Pipeline</div><span className={styles.count}>{sidebarCounts.political}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("kg")}>
              <div className={styles.name}><span className={styles.icon}>✦</span>Knowledge Graph</div><span className={styles.count}>{sidebarCounts.kg}</span>
            </div>
          </div>
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Platform <span>2</span></div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("deploy")}>
              <div className={styles.name}><span className={styles.icon}>◈</span>Deploys</div><span className={styles.count}>{sidebarCounts.deploy}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("supabase")}>
              <div className={styles.name}><span className={styles.icon}>⌘</span>Supabase</div><span className={styles.count}>{sidebarCounts.supabase}</span>
            </div>
          </div>
          </>
          )}
          {activeVenture === "zuse" && (
          <>
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Selene Ops <span>4</span></div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("inbox")}>
              <div className={styles.name}><span className={styles.icon}>✉</span>Inbox</div><span className={styles.count}>{sidebarCounts.inbox}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("finance")}>
              <div className={styles.name}><span className={styles.icon}>$</span>Finance</div><span className={styles.count}>{sidebarCounts.finance}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("leads")}>
              <div className={styles.name}><span className={styles.icon}>◎</span>Leads</div><span className={styles.count}>{sidebarCounts.leads}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("brief")}>
              <div className={styles.name}><span className={styles.icon}>◆</span>Weekly Brief</div><span className={styles.count}>{sidebarCounts.brief}</span>
            </div>
          </div>
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Business <span>2</span></div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("oaktree")}>
              <div className={styles.name}><span className={styles.icon}>✦</span>Oak Tree Deal</div><span className={styles.count}>{sidebarCounts.oaktree}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("formation")}>
              <div className={styles.name}><span className={styles.icon}>⚖</span>Formation / Legal</div><span className={styles.count}>{sidebarCounts.formation}</span>
            </div>
          </div>
          </>
          )}
          {activeVenture === "telehealth" && (
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Telehealth Platform</div>
            <div className={styles.sidebarEmpty}>Nothing wired here yet — first strand lands when the venture does.</div>
          </div>
          )}
          <div className={styles.sidebarFooter}>
            <div className={styles.pill} onClick={requestNewStrand}>+ New Strand</div>
            <div className={styles.pill} onClick={showRunnerInfo}>Runners: 1</div>
          </div>
        </div>

        <div className={styles.canvasWrap}>
          <div className={styles.canvas} ref={canvasRef}>
            <div className={styles.bgLayer} ref={bgLayerRef}></div>
            <div className={styles.fieldLayer} ref={fieldLayerRef}>
              <svg className={styles.wiring} ref={svgRef}>
                {lines.map(l => (
                  <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeOpacity={0.18} strokeWidth={1} />
                ))}
              </svg>

              <div className={`${styles.node} ${styles.core}`} style={{ left: "50%", top: "44%" }}>
                <div className={styles.circle}>◆</div>
                <div className={styles.label}>SELENE</div>
              </div>

              {NODES.map(n => {
                const wired = wiredNodeVisual(n.id);
                const status: NodeStatus = n.id === "bug" ? (sidebarCounts.bug > 0 ? "warn" : "good") : wired ? wired.status : n.status;
                const subText = n.id === "bug" ? bugSub : wired ? wired.sub : n.sub;
                const dimmed = NODE_VENTURE[n.id] !== activeVenture;
                return (
                  <div
                    key={n.id}
                    className={[
                      styles.node,
                      status === "warn" ? styles.warn : "",
                      status === "good" ? styles.good : "",
                      status === "bad" ? styles.bad : "",
                      flaringIds.has(n.id) ? styles.flare : "",
                      dimmed ? styles.dimmed : "",
                    ].filter(Boolean).join(" ")}
                    style={{ left: `${n.x}%`, top: `${n.y}%` }}
                    onClick={(e) => { e.stopPropagation(); inspectNode(n); }}
                  >
                    <div className={styles.circle}>{n.icon}</div>
                    <div className={styles.label}>{n.label}</div>
                    <div className={styles.sub}>{subText}</div>
                  </div>
                );
              })}
            </div>

            <div className={`${styles.statCorner} ${styles.tl}`}>42,000 NEURONS · 2 VENTURES</div>
            <div className={`${styles.statCorner} ${styles.tr}`}>NEURAL CORE · CONNECTED</div>
            <div className={`${styles.statCorner} ${styles.br}`}>ZUSE HOLDINGS LLC · CHARON ACTIVE</div>

            <div className={styles.chatlog}>
              {bubbles.map(b => (
                <div key={b.id} className={`${styles.bubble} ${b.sender === "you" ? styles.you : ""}`}>
                  <span className={styles.tag}>{b.sender === "you" ? "YOU" : "SELENE"}</span>
                  <span className={styles.msg}>{b.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.voicebar}>
            <div className={`${styles.mic} ${micArmed ? styles.armed : ""}`} onClick={(e) => { e.stopPropagation(); toggleMic(); }}>
              <div className={styles.ring}></div>●
            </div>
            <form className={styles.chatForm} onSubmit={sendChatMessage}>
              <input
                className={styles.chatInput}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="ask Selene anything"
                disabled={chatSending}
              />
              <button type="submit" className={styles.chatSend} disabled={chatSending || !chatInput.trim()}>
                {chatSending ? "…" : "send"}
              </button>
            </form>
            <div className={`${styles.wake} ${styles.hideOnTiny}`} onClick={toggleMic}>
              {micArmed ? "MIC · ARMED · LISTENING" : "MIC · WAKE WORD OFF · TAP TO ARM"}
            </div>
          </div>
        </div>

        <div className={styles.feedPanel}>
          <h3>Live Feed <span>●</span></h3>
          <div>
            {feed.map(item => (
              <div
                key={item.id}
                className={[
                  styles.feedItem,
                  item.tone === "ok" ? styles.toneOk : "",
                  item.tone === "pending" ? styles.tonePending : "",
                  item.tone === "bad" ? styles.toneBad : "",
                ].filter(Boolean).join(" ")}
              >
                <span className={styles.t}>{item.text}</span><span className={styles.ts}>{item.ts}</span>
              </div>
            ))}
          </div>
          <div className={styles.terminalBox}>
            {terminal.map((line, i) => (
              <div key={i} className={`${styles.line} ${line.dim ? styles.dimLine : ""}`}>
                {line.text} {line.cursor && <span className={styles.cursorBlink}>&nbsp;</span>}
              </div>
            ))}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
