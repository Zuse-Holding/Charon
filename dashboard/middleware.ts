import { NextRequest, NextResponse } from "next/server";
import { authConfigured, SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// Everything is behind the login — pages, API routes, and the JS bundles
// themselves (which carry the Supabase anon key). Only the login page, its
// form handler, and the two brand images are public.
//
// Local dev with no DASHBOARD_PASSWORD set stays open so `npm run dev`
// just works; a production deploy without it is locked, not open.

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/icon.svg", "/zuse-holdings-logo.svg"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (!authConfigured() && process.env.NODE_ENV !== "production") return NextResponse.next();

  if (await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};
