import type { ReactNode } from "react";
import { PRODUCTS, productName, type ProductKey } from "./products";

// The header every Metis site renders: the Metis mark, the product name, a
// product switcher, the site's own links, and a sign-in button that says
// "Sign in" everywhere. Plain <a> links and a native <details> switcher, so
// it works in Next.js and Vite alike, with or without JavaScript.

export interface HeaderLink {
  href: string;
  label: string;
}

export interface MetisHeaderProps {
  product: ProductKey;
  /** Where the mark goes: the product's own home. */
  homeHref?: string;
  /** The site's own nav (Pricing, Track record, ...). */
  links?: HeaderLink[];
  /** Replaces the default "Sign in" button, e.g. "Open app" when signed in. */
  actions?: ReactNode;
  signInHref?: string;
}

export function MetisHeader({ product, homeHref = "/", links = [], actions, signInHref = "/login" }: MetisHeaderProps) {
  return (
    <header className="m-header">
      <a href={homeHref} className="m-brand" aria-label={product === "hub" ? "Metis home" : `Metis ${productName(product)} home`}>
        <span className="m-brand-mark" aria-hidden />
        <span className="m-brand-text">
          <span className="m-brand-metis">METIS</span>
          {product !== "hub" && <span className="m-brand-product">{productName(product)}</span>}
        </span>
      </a>

      <details className="m-switcher">
        <summary>
          Products <span aria-hidden>▾</span>
        </summary>
        <ul className="m-switcher-menu">
          {PRODUCTS.map((p) => (
            <li key={p.key}>
              <a href={p.url} aria-current={p.key === product ? "page" : undefined}>
                <span className="m-switcher-name">
                  {p.name}
                  {p.key === product && <span className="m-switcher-here"> · you&apos;re here</span>}
                </span>
                <span className="m-switcher-blurb">{p.blurb}</span>
              </a>
            </li>
          ))}
        </ul>
      </details>

      {links.length > 0 && (
        <nav className="m-header-links" aria-label="Site">
          {links.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
        </nav>
      )}

      <div className="m-header-actions">
        {actions ?? <a href={signInHref} className="m-btn m-btn-ghost">Sign in</a>}
      </div>
    </header>
  );
}
