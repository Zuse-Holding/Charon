import { notFound } from "next/navigation";

// Retired (task 2.4) — was a placeholder page with no real case studies,
// linked from nav/sitemap despite having nothing to show. The route stays
// reachable (no broken link for anyone with it bookmarked/indexed) but now
// 404s instead of presenting a "coming soon" page as if it were finished
// content. Bring this back once there are real customer stories to publish.
export default function CaseStudiesPage() {
  notFound();
}
