"use client";
import { AmbiguousOption } from "../lib/ambiguous-entities";
import styles from "./DisambiguationModal.module.css";

interface DisambiguationModalProps {
  query: string;
  options: AmbiguousOption[];
  onSelect: (option: AmbiguousOption) => void;
  onCancel: () => void;
}

export default function DisambiguationModal({ query, options, onSelect, onCancel }: DisambiguationModalProps) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Which "{query}"?</span>
          <button className={styles.close} onClick={onCancel}>✕</button>
        </div>
        <p className={styles.subtitle}>
          Multiple companies match this name — pick the one you mean.
        </p>
        <div className={styles.options}>
          {options.map((opt) => (
            <button key={opt.label} className={styles.option} onClick={() => onSelect(opt)}>
              <span className={styles.optionLabel}>{opt.label}</span>
              <span className={styles.optionDescription}>{opt.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
