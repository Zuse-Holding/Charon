"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ops.module.css";
import { createClient } from "../../lib/supabase/client";

// ── Static data (ported 1:1 from zuse-intel-ops-live-v3.html) ──────────────

type NodeStatus = "warn" | "good" | null;

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
  { id: "bug",       x: 22, y: 18, icon: "🐞", label: "Bug Watcher",       sub: "checking…",    status: null },
  { id: "deploy",    x: 78, y: 18, icon: "✓",        label: "Deploys",           sub: "live",         status: "good" },
  { id: "supabase",  x: 12, y: 50, icon: "📊",  label: "Supabase",          sub: "nominal",      status: null },
  { id: "oaktree",   x: 88, y: 50, icon: "🌳",  label: "Oak Tree",          sub: "NDA pending",  status: "warn" },
  { id: "briefing",  x: 27, y: 80, icon: "📰",  label: "Briefing",          sub: "daily 08:00",  status: null },
  { id: "formation", x: 73, y: 80, icon: "⚖",        label: "Formation",         sub: "in progress",  status: null },
  { id: "political", x: 50, y: 86, icon: "▶",        label: "Political Pipeline", sub: "stubbed",     status: null },
];

const NODE_IDS = NODES.map(n => n.id);
const SIDEBAR_NODE_IDS = [...NODE_IDS, "kg"]; // "kg" has a sidebar entry but no canvas node (matches original)

const NODE_COLORS: Record<string, string> = {
  bug: "#ffd24a", deploy: "#30d158", supabase: "#4da3ff",
  oaktree: "#ff9a4d", briefing: "#7ea8ff", formation: "#9fb0c8", political: "#ff7ab8",
};
const DEFAULT_PARTICLE_COLOR = "#4de3ff"; // was #ff3b30 pre-Tron-blue swap

const VIEW_TABS = ["business", "personal", "folders", "team", "usage", "memory"];

interface TermLine { text: string; dim?: boolean; cursor?: boolean; }

const INITIAL_TERMINAL: TermLine[] = [
  { text: "$ selene status" },
  { text: "runner: connected · 1 active", dim: true },
  { text: "strands: 5 · tasks today: 7", dim: true },
  { text: "$", cursor: true },
];

interface FeedItem { id: number; text: string; ts: string; highlight?: boolean; }

interface AgentRunRow {
  id: string;
  created_at: string;
  task: string;
  node_id: string;
  source: string | null;
  diagnosis: string | null;
  confidence: string | null;
  action_taken: string | null;
  pr_url: string | null;
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmtTs(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function nowTs() { return fmtTs(new Date().toISOString()); }

function feedTextFor(row: AgentRunRow): { text: string; highlight: boolean } {
  const prOpened = row.action_taken === "pr_opened";
  const suffix = prOpened ? " — draft PR opened" : row.action_taken === "diagnosis_only" ? " — diagnosed, no action needed" : "";
  return { text: `Selene: ${row.task}${suffix}`, highlight: prOpened };
}
function bubbleTextFor(row: AgentRunRow): string | null {
  if (!row.diagnosis) return null;
  return row.diagnosis.length > 160 ? row.diagnosis.slice(0, 157) + "…" : row.diagnosis;
}

let feedIdSeq = 1;
let bubbleIdSeq = 1;

export default function OpsClient() {
  // ── Layout / nav state ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("business");
  const [activeVenture, setActiveVenture] = useState("metis");

  // ── Metrics (real data — Supabase; MRR dropped, no Stripe integration yet) ──
  const [leads, setLeads] = useState(0);       // signups today
  const [tasksToday, setTasksToday] = useState(0); // agent_runs in last 24h
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

  // ── Feed / chat ──────────────────────────────────────────────────────
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [bubbles, setBubbles] = useState<{ id: number; text: string }[]>([]);

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

  function addFeedItem(text: string, highlight?: boolean, ts?: string) {
    setFeed(prev => [{ id: feedIdSeq++, text, ts: ts ?? nowTs(), highlight }, ...prev].slice(0, 8));
  }

  function addBubble(text: string) {
    setBubbles(prev => [...prev, { id: bubbleIdSeq++, text }].slice(-4));
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

  // ── Drag-pan background ───────────────────────────────────────────────
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
      let ox = e.clientX - dragState.current.startX;
      let oy = e.clientY - dragState.current.startY;
      ox = Math.max(-80, Math.min(80, ox));
      oy = Math.max(-80, Math.min(80, oy));
      dragState.current.offsetX = ox;
      dragState.current.offsetY = oy;
      if (bgLayerRef.current) bgLayerRef.current.style.transform = `translate(${ox * 0.4}px, ${oy * 0.4}px)`;
      if (fieldLayerRef.current) fieldLayerRef.current.style.transform = `translate(${ox * 0.15}px, ${oy * 0.15}px)`;
    };
    const onMouseUp = () => {
      dragState.current.dragging = false;
      canvas.classList.remove(styles.grabbing);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Idle drift when not dragging ─────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (dragState.current.dragging) return;
      driftT.current += 0.01;
      const dx = Math.sin(driftT.current) * 6;
      const dy = Math.cos(driftT.current * 0.8) * 4;
      if (bgLayerRef.current) bgLayerRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }, 50);
    return () => clearInterval(interval);
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

  // ── Initial real data: metrics, sidebar counts, feed ─────────────────
  useEffect(() => {
    let cancelled = false;

    fetch("/api/ops/summary", { credentials: "include" })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data || cancelled) return;

        const last24h: AgentRunRow[] = data.agentRuns?.last24h ?? [];
        const last10: AgentRunRow[] = data.agentRuns?.last10 ?? [];

        const counts = Object.fromEntries(SIDEBAR_NODE_IDS.map(id => [id, 0])) as Record<string, number>;
        for (const row of last24h) {
          if (row.node_id in counts) counts[row.node_id] += 1;
        }
        const bugWatcherOpenCount: number = data.sentryIssues?.bugWatcherOpenCount ?? 0;
        counts.bug = bugWatcherOpenCount;
        setSidebarCounts(counts);
        setBugSub(bugWatcherOpenCount === 0 ? "clear" : `${bugWatcherOpenCount} open`);

        setTasksToday(last24h.length);
        setLeads(data.supabaseCounts?.signupsToday ?? 0);

        setFeed(
          last10.map((row: AgentRunRow) => {
            const { text, highlight } = feedTextFor(row);
            return { id: feedIdSeq++, text, ts: fmtTs(row.created_at), highlight };
          })
        );
      })
      .catch(() => { /* leave defaults on failure */ });

    addBubble("Hey. Bug Watcher and Daily Briefing are both live. Ping me if you need anything.");

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live updates: Supabase realtime subscription on agent_runs INSERT ──
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("agent_runs_changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_runs" },
        (payload) => {
          const row = payload.new as AgentRunRow;
          const { text, highlight } = feedTextFor(row);
          addFeedItem(text, highlight, fmtTs(row.created_at));
          flareNode(row.node_id);

          const bubbleText = bubbleTextFor(row);
          if (bubbleText) addBubble(bubbleText);

          setTasksToday(v => v + 1);
          setSidebarCounts(prev => ({ ...prev, [row.node_id]: (prev[row.node_id] ?? 0) + 1 }));
          if (row.node_id === "bug") {
            setBugSub(prev => {
              const current = parseInt(prev, 10);
              const next = (isNaN(current) ? 0 : current) + (row.action_taken === "pr_opened" ? 0 : 1);
              return next === 0 ? "clear" : `${next} open`;
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={styles.opsRoot}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logo}>ZUSE<span>::</span>INTEL OPS</div>
          <div className={styles.status}><div className={styles.dot}></div> SELENE · CONNECTED</div>
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
          <div className={styles.metricMini}><div className={styles.label}>LEADS</div><div className={styles.val}>{leads}</div></div>
          <div className={`${styles.metricMini} ${styles.tasks}`}><div className={styles.label}>TASKS</div><div className={styles.val}>{tasksToday}</div></div>
          <div className={styles.metricMini}><div className={styles.label}>UPTIME</div><div className={styles.val}>{uptime}</div></div>
          <div className={`${styles.metricMini} ${styles.time}`}><div className={styles.label}>TIME</div><div className={styles.val}>{clock}</div></div>
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Ventures <span>2</span></div>
            <div
              className={`${styles.strand} ${activeVenture === "metis" ? styles.active : ""}`}
              onClick={() => setActiveVenture("metis")}
            >
              <div className={styles.name}><span className={styles.icon}>◈</span>Metis Analytics</div><span className={styles.count}>5</span>
            </div>
            <div
              className={`${styles.strand} ${activeVenture === "zuse" ? styles.active : ""}`}
              onClick={() => setActiveVenture("zuse")}
            >
              <div className={styles.name}><span className={styles.icon}>⌘</span>Zuse Holdings</div><span className={styles.count}>3</span>
            </div>
          </div>
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
          <div className={styles.sidebarSection}>
            <div className={styles.groupLabel}>Business <span>2</span></div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("oaktree")}>
              <div className={styles.name}><span className={styles.icon}>✦</span>Oak Tree Deal</div><span className={styles.count}>{sidebarCounts.oaktree}</span>
            </div>
            <div className={`${styles.strand} ${styles.nested}`} onClick={() => flareNode("formation")}>
              <div className={styles.name}><span className={styles.icon}>⚖</span>Formation / Legal</div><span className={styles.count}>{sidebarCounts.formation}</span>
            </div>
          </div>
          <div className={styles.sidebarFooter}>
            <div className={styles.pill} onClick={() => addFeedItem("New strand creation requested (not yet wired to backend)")}>+ New Strand</div>
            <div className={styles.pill}>Runners: 1</div>
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
                const status: NodeStatus = n.id === "bug" ? (sidebarCounts.bug > 0 ? "warn" : "good") : n.status;
                return (
                  <div
                    key={n.id}
                    className={[
                      styles.node,
                      status === "warn" ? styles.warn : "",
                      status === "good" ? styles.good : "",
                      flaringIds.has(n.id) ? styles.flare : "",
                    ].filter(Boolean).join(" ")}
                    style={{ left: `${n.x}%`, top: `${n.y}%` }}
                    onClick={(e) => { e.stopPropagation(); inspectNode(n); }}
                  >
                    <div className={styles.circle}>{n.icon}</div>
                    <div className={styles.label}>{n.label}</div>
                    <div className={styles.sub}>{n.id === "bug" ? bugSub : n.sub}</div>
                  </div>
                );
              })}
            </div>

            <div className={`${styles.statCorner} ${styles.tl}`}>42,000 NEURONS · 2 VENTURES</div>
            <div className={`${styles.statCorner} ${styles.tr}`}>NEURAL CORE · CONNECTED</div>
            <div className={`${styles.statCorner} ${styles.br}`}>ZUSE HOLDINGS LLC · CHARON ACTIVE</div>

            <div className={styles.chatlog}>
              {bubbles.map(b => (
                <div key={b.id} className={styles.bubble}>
                  <span className={styles.tag}>SELENE</span>
                  <span className={styles.msg}>{b.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.voicebar}>
            <div className={`${styles.mic} ${micArmed ? styles.armed : ""}`} onClick={(e) => { e.stopPropagation(); toggleMic(); }}>
              <div className={styles.ring}></div>●
            </div>
            <div className={styles.prompt}>talk to <b>Selene</b></div>
            <div className={styles.wake} onClick={toggleMic}>
              {micArmed ? "MIC · ARMED · LISTENING" : "MIC · WAKE WORD OFF · TAP TO ARM"}
            </div>
          </div>
        </div>

        <div className={styles.feedPanel}>
          <h3>Live Feed <span>●</span></h3>
          <div>
            {feed.map(item => (
              <div key={item.id} className={`${styles.feedItem} ${item.highlight ? styles.highlight : ""}`}>
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
      </div>
    </div>
  );
}
