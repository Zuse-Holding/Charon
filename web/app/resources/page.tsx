import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import { PRODUCTS, PRODUCT_IDS, isProductId } from "../../lib/products";
import { getAllResourcePosts } from "../../lib/resources";
import styles from "./resources.module.css";

export const metadata: Metadata = {
  title: "Resources — Metis",
  description:
    "Guides from the team building Metis: company research, buying a small business, and how the Metis Committee makes and grades its calls.",
  openGraph: {
    title: "Resources — Metis",
    description: "Guides on company research, buying a small business, and the Metis Committee.",
    url: "https://metisanalytic.com/resources",
    type: "website",
  },
};

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Frontmatter dates are plain YYYY-MM-DD, which parse as UTC midnight; format
  // in UTC too, or US time zones show the day before.
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product } = await searchParams;
  const active = isProductId(product) ? product : null;
  const posts = getAllResourcePosts().filter((p) => !active || p.product === active);

  return (
    <MarketingShell>
      <section className={styles.hero}>
        <h1 className={styles.title}>Resources</h1>
        <p className={styles.sub}>
          Guides on company research, buying a small business, and how the Metis Committee makes and grades its calls.
        </p>
        <nav className={styles.filters} aria-label="Filter by product">
          <Link href="/resources" className={`${styles.filter} ${active ? "" : styles.filterActive}`} aria-current={active ? undefined : "page"}>
            All
          </Link>
          {PRODUCT_IDS.map((id) => (
            <Link
              key={id}
              href={`/resources?product=${id}`}
              className={`${styles.filter} ${active === id ? styles.filterActive : ""}`}
              aria-current={active === id ? "page" : undefined}
            >
              {PRODUCTS[id].name}
            </Link>
          ))}
        </nav>
      </section>

      <section className={styles.grid}>
        {posts.length === 0 && <div className={styles.empty}>New guides are on the way.</div>}
        {posts.map((post) => (
          <Link key={post.slug} href={`/resources/${post.slug}`} className={styles.card}>
            <div className={styles.cardMeta}>
              <span>{PRODUCTS[post.product].name} · {post.category}</span>
              <span>{formatDate(post.date)} · {post.readTime}</span>
            </div>
            <div className={styles.cardTitle}>{post.title}</div>
            <div className={styles.cardDesc}>{post.description}</div>
          </Link>
        ))}
      </section>
    </MarketingShell>
  );
}
