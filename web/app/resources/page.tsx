import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import { getAllResourcePosts } from "../../lib/resources";
import styles from "./resources.module.css";

export const metadata: Metadata = {
  title: "Resources — Metis",
  description:
    "Guides and comparisons on company research, diligence workflows, and public-records research — from the team building Metis.",
  openGraph: {
    title: "Resources — Metis",
    description: "Guides and comparisons on company research and diligence workflows.",
    url: "https://metisanalytic.com/resources",
    type: "website",
  },
};

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ResourcesPage() {
  const posts = getAllResourcePosts();

  return (
    <MarketingShell>
      <section className={styles.hero}>
        <h1 className={styles.title}>Resources</h1>
        <p className={styles.sub}>
          Guides and comparisons on company research, diligence workflows, and public-records research.
        </p>
      </section>

      <section className={styles.grid}>
        {posts.length === 0 && <div className={styles.empty}>New guides are on the way.</div>}
        {posts.map((post) => (
          <Link key={post.slug} href={`/resources/${post.slug}`} className={styles.card}>
            <div className={styles.cardMeta}>
              <span>{post.category}</span>
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
