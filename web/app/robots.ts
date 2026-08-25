import type { MetadataRoute } from "next";

const SITE_URL = "https://metisanalytic.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/app",
        "/app/",
        "/dashboard",
        "/settings",
        "/watchlist",
        "/intel-feed",
        "/knowledge-graph",
        "/reports",
        "/print",
        "/api",
        "/login",
        "/logout",
        "/auth",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
