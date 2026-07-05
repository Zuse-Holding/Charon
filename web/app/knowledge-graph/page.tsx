"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";
import KGQueryPanel from "../../components/KGQueryPanel";
import KGSearchBox from "../../components/KGSearchBox";

interface Entity {
  id: string;
  name: string;
  type: "company" | "person" | "product";
  first_seen_at: string;
}

interface Relationship {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
}

interface NodeData {
  id: string;
  name: string;
  type: "company" | "person" | "product";
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface EdgeData {
  source: string;
  target: string;
  label: string;
}

const TYPE_COLORS = {
  company: "#ff6b2b",
  person:  "#00e5ff",
  product: "#00ff94",
};

const PLANNED_FEATURES = [
  { icon: "◈", title: "Click to Expand", desc: "Click any node to load its full entity graph — see everyone connected to a company or person." },
  { icon: "⬡", title: "Cross-Entity Queries", desc: 'Ask "who invested in both X and Y?" by traversing the relationship graph.' },
  { icon: "◎", title: "Ecosystem Mapping", desc: "Map entire market segments — all fintech competitors, all AI investors — in one view." },
];

export default function KnowledgeGraph() {
  const [entities, setEntities]           = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selected, setSelected]           = useState<NodeData | null>(null);
  const [hoveredId, setHoveredId]         = useState<string | null>(null);
  const canvasRef                         = useRef<HTMLCanvasElement>(null);
  const nodesRef                          = useRef<NodeData[]>([]);
  const edgesRef                          = useRef<EdgeData[]>([]);
  const animFrameRef                      = useRef<number>(0);
  const dragRef                           = useRef<{ node: NodeData } | null>(null);
  const panRef                            = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null);
  const transformRef                      = useRef({ scale: 1, tx: 0, ty: 0 });
  const hoveredRef                        = useRef<string | null>(null);
  const selectedRef                       = useRef<NodeData | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [eRes, rRes] = await Promise.all([
          fetch("/api/knowledge-graph/entities"),
          fetch("/api/knowledge-graph/relationships"),
        ]);
        if (eRes.ok) setEntities(await eRes.json());
        if (rRes.ok) setRelationships(await rRes.json());
      } catch {} finally { setLoading(false); }
    }
    load();
  }, []);

  // Keep refs in sync with state for use in canvas callbacks
  useEffect(() => { hoveredRef.current = hoveredId; }, [hoveredId]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Build nodes and edges
  useEffect(() => {
    if (entities.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr || 900;
    const H = canvas.height / dpr || 500;

    // Sort entities by relationship count — most connected first
    // then cap at 35 for performance and readability
    const relCount = new Map<string, number>();
    for (const r of relationships) {
      relCount.set(r.from_entity_id, (relCount.get(r.from_entity_id) ?? 0) + 1);
      relCount.set(r.to_entity_id,   (relCount.get(r.to_entity_id)   ?? 0) + 1);
    }
    const sorted = [...entities].sort((a, b) => (relCount.get(b.id) ?? 0) - (relCount.get(a.id) ?? 0));
    const visible = sorted.slice(0, 50);

    const nodes: NodeData[] = visible.map((e, i) => {
      const angle  = (i / Math.min(visible.length, 35)) * Math.PI * 2;
      const radius = Math.min(W, H) * 0.28 + Math.random() * 50 - 25;
      return {
        id: e.id, name: e.name, type: e.type,
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0, r: 16,
      };
    });

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: EdgeData[] = relationships
      .filter(r => nodeIds.has(r.from_entity_id) && nodeIds.has(r.to_entity_id))
      .slice(0, 120)
      .map(r => ({ source: r.from_entity_id, target: r.to_entity_id, label: r.relationship_type.replace(/_/g, " ") }));

    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [entities, relationships]);

  // Force simulation
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const cx = W / 2, cy = H / 2;

    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.0008;
      node.vy += (cy - node.y) * 0.0008;
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x, dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 900 / (dist * dist);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const edge of edges) {
      const a = nodeMap.get(edge.source), b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 130) * 0.025;
      a.vx += (dx / dist) * force; a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force;
    }

    for (const node of nodes) {
      if (dragRef.current?.node === node) continue;
      node.vx *= 0.85; node.vy *= 0.85;
      node.x = Math.max(node.r + 4, Math.min(W - node.r - 4, node.x + node.vx));
      node.y = Math.max(node.r + 4, Math.min(H - node.r - 4, node.y + node.vy));
    }
  }, []);

  // Canvas draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resizeCanvas() {
      if (!canvas || !ctx) return;
      const dpr  = window.devicePixelRatio || 1;
      const cssW = canvas.parentElement?.clientWidth ?? 900;
      const cssH = 520;
      canvas.width        = Math.round(cssW * dpr);
      canvas.height       = Math.round(cssH * dpr);
      canvas.style.width  = cssW + "px";
      canvas.style.height = cssH + "px";
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function draw() {
      if (!canvas || !ctx) return;
      const dpr   = window.devicePixelRatio || 1;
      const W     = canvas.width / dpr;
      const H     = canvas.height / dpr;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const nodeMap   = new Map(nodes.map(n => [n.id, n]));
      const { scale, tx, ty } = transformRef.current;
      const hovered  = hoveredRef.current;
      const sel      = selectedRef.current;

      ctx.save();
      // Apply device pixel ratio — critical for crisp rendering
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Apply zoom/pan on top of DPR
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // Edges
      for (const edge of edges) {
        const a = nodeMap.get(edge.source), b = nodeMap.get(edge.target);
        if (!a || !b) continue;
        const hi = hovered === a.id || hovered === b.id || sel?.id === a.id || sel?.id === b.id;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = hi ? "rgba(255,107,43,0.7)" : "rgba(255,255,255,0.1)";
        ctx.lineWidth = (hi ? 1.5 : 0.7) / scale;
        ctx.stroke();
        if (hi && edge.label && scale > 0.4) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          ctx.font = `${Math.max(7, 9 / scale)}px JetBrains Mono, monospace`;
          ctx.fillStyle = "rgba(255,107,43,0.85)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(edge.label.toUpperCase(), mx, my - 7 / scale);
        }
      }

      // Nodes
      for (const node of nodes) {
        const isH = hovered === node.id;
        const isS = sel?.id === node.id;
        const color = TYPE_COLORS[node.type];

        if (isH || isS) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 7 / scale, 0, Math.PI * 2);
          const g = ctx.createRadialGradient(node.x, node.y, node.r - 2, node.x, node.y, node.r + 7 / scale);
          g.addColorStop(0, color + "66");
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = isS ? color : color + "bb";
        ctx.fill();
        ctx.strokeStyle = isS ? "#ffffff" : color;
        ctx.lineWidth = (isS ? 2.5 : 1.2) / scale;
        ctx.stroke();

        // Crisp text — font size scales inversely with zoom
        const fs = Math.max(6, Math.min(13, node.r * 0.75)) / scale;
        ctx.font = `600 ${fs}px Space Grotesk, sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = node.name.length > 10 ? node.name.slice(0, 9) + "\u2026" : node.name;
        ctx.fillText(label, node.x, node.y);
      }

      ctx.restore();
      simulate();
      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [entities, relationships, simulate]);

  // Wheel zoom
  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const t     = transformRef.current;
    const newScale = Math.max(0.2, Math.min(4, t.scale * delta));
    // Zoom toward cursor
    t.tx = mx - (mx - t.tx) * (newScale / t.scale);
    t.ty = my - (my - t.ty) * (newScale / t.scale);
    t.scale = newScale;
  }

  // Convert screen coords to world coords
  function screenToWorld(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale, tx, ty } = transformRef.current;
    return {
      x: (e.clientX - rect.left - tx) / scale,
      y: (e.clientY - rect.top  - ty) / scale,
    };
  }

  function getNodeAt(e: React.MouseEvent<HTMLCanvasElement>): NodeData | null {
    const { x, y } = screenToWorld(e);
    for (const node of nodesRef.current) {
      const dx = node.x - x, dy = node.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.r + 4) return node;
    }
    return null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      const { x, y } = screenToWorld(e);
      dragRef.current.node.x = x;
      dragRef.current.node.y = y;
      return;
    }
    if (panRef.current) {
      const t = transformRef.current;
      t.tx = panRef.current.origTx + (e.clientX - panRef.current.startX);
      t.ty = panRef.current.origTy + (e.clientY - panRef.current.startY);
      return;
    }
    const node = getNodeAt(e);
    const newId = node?.id ?? null;
    if (newId !== hoveredRef.current) setHoveredId(newId);
    if (canvasRef.current) canvasRef.current.style.cursor = node ? "grab" : "default";
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const node = getNodeAt(e);
    if (node) {
      dragRef.current = { node };
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    } else {
      const t = transformRef.current;
      panRef.current = { startX: e.clientX, startY: e.clientY, origTx: t.tx, origTy: t.ty };
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    }
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      const node = getNodeAt(e);
      if (node && node === dragRef.current.node) {
        setSelected(prev => prev?.id === node.id ? null : node);
      }
    }
    dragRef.current = null;
    panRef.current  = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "default";
  }

  const companiesCount = entities.filter(e => e.type === "company").length;
  const peopleCount    = entities.filter(e => e.type === "person").length;
  const productsCount  = entities.filter(e => e.type === "product").length;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>

          <div className={styles.graphHeader}>
            <div>
              <h1 className={styles.title}>Knowledge Graph</h1>
              <div className={styles.subtitle}>
                {loading ? "Loading..." : `${entities.length} entities · ${relationships.length} relationships`}
              </div>
            </div>
            <div className={styles.headerRight}>
              <div className={styles.legend}>
              <KGSearchBox
  entities={entities}
  onSelect={(entity) => {
    const node = nodesRef.current.find(n => n.id === entity.id);
    if (node) setSelected(node);
  }}
/>

                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <span key={type} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ background: color }} />
                    {type}
                  </span>
                ))}
              </div>
              <div className={styles.zoomHint}>scroll to zoom · drag to pan</div>
            </div>
          </div>

          {entities.length === 0 && !loading ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>◉</div>
              <div className={styles.emptyTitle}>No entities yet</div>
              <div className={styles.emptyText}>Run some research to start building your knowledge graph.</div>
            </div>
          ) : (
            <div className={styles.graphArea}>
              <KGQueryPanel />
              <canvas
                ref={canvasRef}
                className={styles.canvas}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { dragRef.current = null; panRef.current = null; setHoveredId(null); }}
                onWheel={handleWheel}
              />

              {selected && (
                <div className={styles.nodePanel}>
                  <div className={styles.nodePanelHeader}>
                    <span className={styles.nodeDot} style={{ background: TYPE_COLORS[selected.type] }} />
                    <span className={styles.nodeName}>{selected.name}</span>
                    <button className={styles.closeBtn} onClick={() => setSelected(null)}>✕</button>
                  </div>
                  <div className={styles.nodeType}>{selected.type.toUpperCase()}</div>
                  <div className={styles.nodeRels}>
                    {relationships
                      .filter(r => r.from_entity_id === selected.id || r.to_entity_id === selected.id)
                      .slice(0, 8)
                      .map((r, i) => {
                        const isFrom = r.from_entity_id === selected.id;
                        const otherId = isFrom ? r.to_entity_id : r.from_entity_id;
                        const other = entities.find(e => e.id === otherId);
                        if (!other) return null;
                        return (
                          <div key={i} className={styles.nodeRelRow}>
                            <span className={styles.nodeRelType}>{r.relationship_type.replace(/_/g, " ")}</span>
                            <span className={styles.nodeRelName}>{other.name}</span>
                          </div>
                        );
                      })
                    }
                  </div>
                  <div className={styles.nodeActions}>
                    <button
                      className={styles.nodeResearchBtn}
                      onClick={() => {
                        window.location.href = `/app?research=${encodeURIComponent(selected.name)}`;
                      }}
                    >
                      ◈ Research {selected.name} →
                    </button>
                    <button
                      className={styles.nodeExpandBtn}
                      onClick={async () => {
                        if (!selected) return;
                        const res = await fetch("/api/knowledge-graph/expand", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ entityName: selected.name, entityType: selected.type }),
                        });
                        const data = await res.json();
                        alert(data.message ?? data.error ?? "Expansion started");
                      }}
                    >
                      ⬡ Expand connections
                    </button>
                    <button
                      className={styles.nodeRemoveBtn}
                      onClick={async () => {
                        await fetch(`/api/knowledge-graph/entities/${selected.id}`, { method: "DELETE" });
                        setEntities(prev => prev.filter(e => e.id !== selected.id));
                        setRelationships(prev => prev.filter(r => r.from_entity_id !== selected.id && r.to_entity_id !== selected.id));
                        setSelected(null);
                      }}
                    >
                      Remove from graph
                    </button>
                  </div>
          )}

          <div className={styles.statsRow}>
            {[
              { num: entities.length,      label: "Total Entities", color: "var(--orange)" },
              { num: companiesCount,        label: "Companies",      color: "var(--orange)" },
              { num: peopleCount,           label: "People",         color: "var(--cyan)" },
              { num: productsCount,         label: "Products",       color: "var(--green)" },
              { num: relationships.length,  label: "Relationships",  color: "var(--text)" },
            ].map(s => (
              <div key={s.label} className={styles.statCard}>
                <div className={styles.statNum} style={{ color: s.color }}>{loading ? "—" : s.num}</div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className={styles.featuresSection}>
            <div className={styles.sectionLabel}>COMING NEXT</div>
            <div className={styles.featuresGrid}>
              {PLANNED_FEATURES.map((f) => (
                <div key={f.title} className={styles.featureCard}>
                  <div className={styles.featureIcon}>{f.icon}</div>
                  <div className={styles.featureTitle}>{f.title}</div>
                  <div className={styles.featureDesc}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
