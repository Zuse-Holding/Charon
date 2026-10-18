"use client";
import { ReactNode } from "react";
import { StateView } from "../metis-ui";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** Kept for existing callers; the shared state view uses its own glyph. */
  icon?: string;
  /** What happened ("No research yet"). */
  title: string;
  /** What the person can do, or more detail when there's also a button. */
  description?: ReactNode;
  action?: EmptyStateAction;
  /** When this changes on its own; null when only the person can change it. */
  when: string | null;
  /** "compact" for tight spaces: table cells, narrow panels, list rows. */
  size?: "default" | "compact";
}

/**
 * Intelligence's empty state, now the shared Metis StateView (web/metis-ui)
 * so empty states read the same on every Metis site: what happened, what
 * you can do, when it changes.
 */
export default function EmptyState({ title, description, action, when, size = "default" }: EmptyStateProps) {
  return (
    <StateView
      kind="empty"
      compact={size === "compact"}
      what={title}
      detail={action ? description : undefined}
      action={action ? <button className="m-btn m-btn-ghost" onClick={action.onClick}>{action.label}</button> : description ?? null}
      when={when}
    />
  );
}
