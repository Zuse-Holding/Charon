"use client";
import { ReactNode } from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** Single glyph/icon, matches the app's icon set (◈ ◎ ◆ ⊞ ⊕ etc.) */
  icon?: string;
  title: string;
  /** Supporting copy. Accepts a node so callers can bold/link/break as needed. */
  description?: ReactNode;
  action?: EmptyStateAction;
  /** "compact" for tight spaces — table cells, narrow panels, list rows. */
  size?: "default" | "compact";
}

/**
 * Shared empty-state pattern used across Dashboard, Watchlist, Reports,
 * Intel Feed, and the Research view — replaces one-off inline
 * "No X yet." text so empty states look and read consistently everywhere.
 */
export default function EmptyState({
  icon = "◈",
  title,
  description,
  action,
  size = "default",
}: EmptyStateProps) {
  return (
    <div className={`${styles.empty} ${size === "compact" ? styles.compact : ""}`}>
      <div className={styles.iconWrap}>
        <span className={styles.icon}>{icon}</span>
      </div>
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.description}>{description}</div>}
      {action && (
        <button className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
