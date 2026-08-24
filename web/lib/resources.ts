import fs from "fs";
import path from "path";

export type ResourcePost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  readTime: string;
  body: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "resources");

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return { data, body: match[2].trim() };
}

export function getAllResourcePosts(): ResourcePost[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  const posts = files.map((file) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
    const { data, body } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, "");
    return {
      slug,
      title: data.title ?? slug,
      description: data.description ?? "",
      date: data.date ?? "",
      category: data.category ?? "Guide",
      readTime: data.readTime ?? "5 min read",
      body,
    };
  });

  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getResourcePost(slug: string): ResourcePost | undefined {
  return getAllResourcePosts().find((p) => p.slug === slug);
}
