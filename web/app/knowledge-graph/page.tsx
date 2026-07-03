"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

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
  const dragRef                           = useRef<{ node: NodeData; offsetX: number; offsetY: number } | null>(null);

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

  // Build nodes and edges from entities/relationships
  useEffect(() => {
    if (entities.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;

    // Place nodes in a rough circle with some randomness
    const nodes: NodeData[] = entities.slice(0, 60).map((e, i) => {
      const angle = (i / Math.min(entities.length, 60)) * Math.PI * 2;
      const radius = Math.min(W, H) * 0.3 + Math.random() * 60 - 30;
      return {
        id: e.id,
        name: e.name,
        type: e.type,
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0,
        r: e.name.length > 12 ? 18 : 14,
      };
    });

    const edges: EdgeData[] = relationships
      .filter(r => nodes.some(n => n.id === r.from_entity_id) && nodes.some(n => n.id === r.to_entity_id))
      .slice(0, 100)
      .map(r => ({
        source: r.from_entity_id,
        target: r.to_entity_id,
        label: r.relationship_type.replace(/_/g, " "),
      }));

    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [entities, relationships]);

  // Force-directed simulation
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // Forces
    for (const node of nodes) {
      // Center gravity
      node.vx += (cx - node.x) * 0.001;
      node.vy += (cy - node.y) * 0.001;

      // Repulsion between nodes
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 800 / (dist * dist);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
    }

    // Attraction along edges
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 120;
      const force = (dist - target) * 0.03;
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= (dy / dist) * force;
    }

    // Apply velocity with damping, clamp to canvas
    for (const node of nodes) {
      if (dragRef.current?.node === node) continue;
      node.vx *= 0.85;
      node.vy *= 0.85;
      node.x = Math.max(node.r + 8, Math.min(W - node.r - 8, node.x + node.vx));
      node.y = Math.max(node.r + 8, Math.min(H - node.r - 8, node.y + node.vy));
    }
  }, []);

  // Canvas draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      if (!canvas || !ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      ctx.clearRect(0, 0, W, H);

      // Draw edges
      for (const edge of edges) {
        const a = nodeMap.get(edge.source);
        const b = nodeMap.get(edge.target);
        if (!a || !b) continue;
        const isHighlighted = hoveredId === a.id || hoveredId === b.id;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = isHighlighted ? "rgba(255,107,43,0.6)" : "rgba(255,255,255,0.08)";
        ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
        ctx.stroke();

        // Edge label on hover
        if (isHighlighted && edge.label) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          ctx.font = "9px JetBrains Mono, monospace";
          ctx.fillStyle = "rgba(255,107,43,0.7)";
          ctx.textAlign = "center";
          ctx.fillText(edge.label.toUpperCase(), mx, my - 4);
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const isHovered   = hoveredId === node.id;
        const isSelected  = selected?.id === node.id;
        const color = TYPE_COLORS[node.type];

        // Glow on hover/select
        if (isHovered || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 6, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(node.x, node.y, node.r, node.x, node.y, node.r + 6);
          grad.addColorStop(0, color + "44");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? color : color + "cc";
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#fff" : color;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        // Node label
        ctx.font = `${node.r > 16 ? 10 : 9}px Space Grotesk, sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const maxWidth = node.r * 2 - 4;
        const label = node.name.length > 12 ? node.name.slice(0, 10) + "…" : node.name;
        ctx.fillText(label, node.x, node.y, maxWidth);
      }

      simulate();
      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [entities, relationships, hoveredId, selected, simulate]);

  // Mouse interactions
  function getNodeAt(e: React.MouseEvent<HTMLCanvasElement>): NodeData | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const node of nodesRef.current) {
      const dx = node.x - x;
      const dy = node.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.r + 4) return node;
    }
    return null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      dragRef.current.node.x = e.clientX - rect.left;
      dragRef.current.node.y = e.clientY - rect.top;
      return;
    }
    const node = getNodeAt(e);
    setHoveredId(node?.id ?? null);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? "grab" : "default";
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const node = getNodeAt(e);
    if (node) {
      dragRef.current = { node, offsetX: 0, offsetY: 0 };
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    }
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      const node = getNodeAt(e);
      if (node && node === dragRef.current.node) setSelected(node);
    }
    dragRef.current = null;
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
            <div className={styles.legend}>
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <span key={type} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: color }} />
                  {type}
                </span>
              ))}
            </div>
          </div>

          {entities.length === 0 && !loading ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>◉</div>
              <div className={styles.emptyTitle}>No entities yet</div>
              <div className={styles.emptyText}>Run some research to start building your knowledge graph. Entities and relationships are extracted automatically after each run.</div>
            </div>
          ) : (
            <div className={styles.graphArea}>
              <canvas
                ref={canvasRef}
                width={900}
                height={500}
                className={styles.canvas}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { dragRef.current = null; setHoveredId(null); }}
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
                </div>
              )}
            </div>
          )}

          <div className={styles.statsRow}>
            {[
              { num: entities.length, label: "Total Entities", color: "var(--orange)" },
              { num: companiesCount,  label: "Companies",      color: "var(--orange)" },
              { num: peopleCount,     label: "People",         color: "var(--cyan)" },
              { num: productsCount,   label: "Products",       color: "var(--green)" },
              { num: relationships.length, label: "Relationships", color: "var(--text)" },
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
