"use client";
import { useState, useMemo } from "react";
import styles from "./KGSearchBox.module.css";

interface Entity {
  id: string;
  name: string;
  type: "company" | "person" | "product";
}

interface Props {
  entities: Entity[];
  onSelect: (entity: Entity) => void;
}

export default function KGSearchBox({ entities, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return entities
      .filter(e => e.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, entities]);

  return (
    <div className={styles.wrap}>
      <input
        className={styles.input}
        placeholder="⌕ Search entities in this graph..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div className={styles.dropdown}>
          {matches.map(e => (
            <button
              key={e.id}
              className={styles.result}
              onMouseDown={() => {
                onSelect(e);
                setQuery(e.name);
                setOpen(false);
              }}
            >
              <span className={`${styles.dot} ${styles[e.type]}`} />
              {e.name}
              <span className={styles.type}>{e.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
