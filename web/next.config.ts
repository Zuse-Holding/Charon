import type { NextConfig } from "next";

// Task 4.4 — AUDIT.md found zero security headers configured anywhere.
// A *reasonable* CSP, not a maximally strict one: Next.js injects inline
// hydration scripts and this app has a few inline <style> blocks (e.g.
// web/app/print/[id]/page.tsx's print stylesheet), so 'unsafe-inline' stays
// on script-src/style-src rather than breaking the app to chase a stricter
// policy — a nonce-based approach that removes 'unsafe-inline' is a real
// follow-up, not something to force into this pass. connect-src is scoped
// to the actual external origins this app talks to from the browser
// (Supabase, Stripe.js if it's ever loaded client-side) rather than left
// wide open.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";

const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com`,
  `img-src 'self' data: https:`,
  `connect-src 'self' https://api.stripe.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `frame-src https://js.stripe.com https://hooks.stripe.com`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

const SECURITY_HEADERS = [
  // 2 years, includeSubDomains — standard HSTS preload-eligible value.
  // Only meaningful over HTTPS (which Vercel enforces already), but the
  // header itself was simply absent before.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt-and-suspenders with frame-ancestors above — older browsers that
  // don't respect CSP's frame-ancestors still honor this.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["compromise"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
