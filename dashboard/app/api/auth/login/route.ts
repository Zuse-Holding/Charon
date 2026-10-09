import { NextRequest, NextResponse } from "next/server";
import { createSessionValue, passwordMatches, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const attempt = String(form.get("password") ?? "");

  if (!(await passwordMatches(attempt))) {
    // Slow down guessing a little; single user, so this costs Nick nothing.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }

  const res = NextResponse.redirect(new URL("/ops", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
