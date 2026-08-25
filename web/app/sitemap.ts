import type { MetadataRoute } from "next";
import { getAllResourcePosts } from "../lib/resources";

const SITE_URL = "https://metisanalytic.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/vs/crunchbase`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/vs/pitchbook`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/case-studies`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/resources`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const postRoutes: MetadataRoute.Sitemap = getAllResourcePosts().map((post) => ({
    url: `${SITE_URL}/resources/${post.slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...postRoutes];
}
