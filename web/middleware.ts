import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Gated by exception: only these need a session. Everything else (the
  // public marketing site, and any unrecognized/typo'd path) falls through
  // to Next's normal routing — including its 404 — instead of being forced
  // through a login redirect.
  const PRIVATE_PREFIXES = [
    "/app",
    "/dashboard",
    "/settings",
    "/watchlist",
    "/intel-feed",
    "/knowledge-graph",
    "/reports",
    "/api",
  ];
  // Stripe calls this directly with its own signature, not a session
  // cookie — gating it behind /login would make Stripe receive a 307
  // instead of our handler ever running. Verified by request signature
  // inside the route itself (web/app/api/stripe/webhook/route.ts), not by
  // auth, so excluding it here is safe.
  const isWebhook = pathname === "/api/stripe/webhook";

  // Task 3.1 — signup/signin/reset-password are called by definition by
  // someone who doesn't have a session yet (that's the whole point of
  // these routes). Gating them behind the same /login redirect as
  // everything else under /api would make it impossible to ever sign up
  // or sign in through them — same bug class as the webhook above, caught
  // the same way (by actually testing the flow, not just reading the code).
  const isAuthRoute = pathname.startsWith("/api/auth/");

  const isPrivateRoute = !isWebhook && !isAuthRoute && PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!user && isPrivateRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
