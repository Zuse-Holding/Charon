import type { ReactNode } from "react";
import { citeText } from "./cite";

// One way to show a source on every Metis site: the document or domain, the
// page or date, and a way to open it. Never an internal key. Pass `href`
// for a plain link, or `onOpen` when opening needs a round trip (a signed
// URL); with neither it's plain text (print, the public sample).

export interface SourceCiteProps {
  /** Document name or domain: "Harbor Line CIM.pdf", "axios.com". */
  source: string;
  /** Page, cell or date: 14 -> "p. 14"; "Oct 16, 2026"; "B12". */
  locator?: string | number | null;
  /** Optional title ("Stripe tips toward staying private"). */
  title?: string;
  href?: string;
  onOpen?: () => void;
  /** Overrides the label while opening, e.g. "Opening…". */
  status?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SourceCite({ source, locator, title, href, onOpen, status, disabled, className = "" }: SourceCiteProps) {
  const text = citeText(source, locator);
  const body = (
    <>
      {title && <span className="m-cite-title">{title}</span>}
      <span className="m-cite-source">{status ?? text}</span>
      {(href || onOpen) && !status && <span className="m-cite-open" aria-hidden>↗</span>}
    </>
  );
  if (href) {
    return (
      <a className={`m-cite ${className}`} href={href} target="_blank" rel="noopener noreferrer" title={`Open ${text}`}>
        {body}
      </a>
    );
  }
  if (onOpen) {
    return (
      <button type="button" className={`m-cite ${className}`} onClick={onOpen} disabled={disabled} title={`Open ${text}`}>
        {body}
      </button>
    );
  }
  return <span className={`m-cite m-cite-static ${className}`}>{body}</span>;
}
