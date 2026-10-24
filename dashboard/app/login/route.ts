import { NextRequest } from "next/server";
import { authConfigured } from "@/lib/session";

// Plain server-rendered HTML, no React and no /_next bundles: those stay
// behind the login (they carry the Supabase anon key). The form posts
// natively to /api/auth/login.

export const dynamic = "force-dynamic";

function page(message: string | null, configured: boolean): string {
  const note = !configured
    ? `<p class="msg">Login isn't set up yet. Add <code>DASHBOARD_PASSWORD</code> to this deploy's environment, then reload.</p>`
    : message
      ? `<p class="msg">${message}</p>`
      : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Selene OS</title>
<link rel="icon" href="/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0a0a0b; --surface:#121215; --line:#26262b; --text:#ededef; --text-dim:#8a8a93;
          --selene:#22d3ee; --ember:#f97316; --danger:#ef4444; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px;
         background:var(--bg); color:var(--text); font-family:Inter, system-ui, sans-serif; }
  form { width:100%; max-width:340px; display:flex; flex-direction:column; gap:12px;
         padding:24px; background:var(--surface); border:1px solid var(--line); border-radius:10px; }
  img { height:22px; align-self:flex-start; margin-bottom:4px; }
  h1 { margin:0; font-size:15px; font-weight:600; }
  p { margin:0; font-size:13px; color:var(--text-dim); line-height:1.45; }
  .msg { color:var(--danger); }
  code { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:12px; color:var(--text); }
  input { padding:10px 12px; border-radius:6px; border:1px solid var(--line); background:var(--bg);
          color:var(--text); font-size:14px; }
  input:focus { outline:2px solid var(--selene); outline-offset:1px; }
  button { padding:10px; border:0; border-radius:6px; background:var(--ember); color:#1a0b02;
           font-weight:600; font-size:13px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
</style></head>
<body>
<form method="post" action="/api/auth/login">
  <img src="/zuse-holdings-logo.svg" alt="Zuse Holdings">
  <h1>Hey. Sign in to see the ops console.</h1>
  ${note}
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus${configured ? "" : " disabled"}>
  <button type="submit"${configured ? "" : " disabled"}>Sign in</button>
</form>
</body></html>`;
}

export async function GET(req: NextRequest) {
  const failed = req.nextUrl.searchParams.get("error") === "1";
  return new Response(page(failed ? "That's not it. Try again." : null, authConfigured()), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
