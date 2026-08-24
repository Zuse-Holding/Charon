import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { MarketingShell } from "../../../components/marketing/MarketingShell";
import shellStyles from "../../../components/marketing/MarketingShell.module.css";
import { getAllResourcePosts, getResourcePost } from "../../../lib/resources";
import styles from "./post.module.css";

export function generateStaticParams() {
  return getAllResourcePosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getResourcePost(slug);
  if (!post) return {};

  return {
    title: `${post.title} — Metis`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      url: `https://metisanalytic.com/resources/${post.slug}`,
      type: "article",
    },
  };
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ResourcePostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getResourcePost(slug);
  if (!post) notFound();

  return (
    <MarketingShell>
      <div className={styles.header}>
        <Link href="/resources" className={styles.back}>← All resources</Link>
        <div className={styles.meta}>
          <span>{post.category}</span>
          <span>{formatDate(post.date)} · {post.readTime}</span>
        </div>
        <h1 className={styles.title}>{post.title}</h1>
        <p className={styles.desc}>{post.description}</p>
      </div>

      <div className={styles.body}>
        <ReactMarkdown>{post.body}</ReactMarkdown>
      </div>

      <div className={styles.ctaBox}>
        <div className={styles.ctaInner}>
          <div className={styles.ctaText}>
            <strong>See it on a real company.</strong>
            Start free — no credit card required.
          </div>
          <Link href="/login?mode=signup" className={shellStyles.ctaPrimary}>Start Free →</Link>
        </div>
      </div>
    </MarketingShell>
  );
}
