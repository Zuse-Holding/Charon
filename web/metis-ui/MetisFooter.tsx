import { DISCLOSURES_URL, LEGAL_ENTITY, PRODUCTS, SUPPORT_EMAIL, type ProductKey } from "./products";

// The same footer on every Metis site: all three products, Privacy, Terms,
// Disclosures and support. Privacy and Terms point at the current site's own
// pages (each product has its own), everything else is shared.

export interface MetisFooterProps {
  product: ProductKey;
  privacyHref?: string;
  termsHref?: string;
  disclosuresHref?: string;
  /** A short line under the links, e.g. a product disclaimer. */
  note?: string;
}

export function MetisFooter({ product, privacyHref = "/privacy", termsHref = "/terms", disclosuresHref = DISCLOSURES_URL, note }: MetisFooterProps) {
  return (
    <footer className="m-footer">
      <nav className="m-footer-links" aria-label="Metis">
        {PRODUCTS.map((p) => (
          <a key={p.key} href={p.url} aria-current={p.key === product ? "page" : undefined}>{p.name}</a>
        ))}
        <a href={privacyHref}>Privacy</a>
        <a href={termsHref}>Terms</a>
        <a href={disclosuresHref}>Disclosures</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </nav>
      {note && <p className="m-footer-note">{note}</p>}
      <p className="m-footer-legal">© {new Date().getFullYear()} {LEGAL_ENTITY}</p>
    </footer>
  );
}
