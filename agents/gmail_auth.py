"""
SELENE OS — one-time Gmail token setup
Runs Google's installed-app OAuth flow on a loopback port and prints a
refresh token for one scope. Run it twice, once per scope, and put each
token in the agent box's env:

    python -m agents.gmail_auth read   ->  GMAIL_READ_REFRESH_TOKEN  (gmail.readonly)
    python -m agents.gmail_auth send   ->  GMAIL_SEND_REFRESH_TOKEN  (gmail.send)

Needs GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET from a Google Cloud
OAuth client of type "Desktop app" with the Gmail API enabled.
"""

from __future__ import annotations

import http.server
import os
import secrets
import sys
import urllib.parse
import webbrowser

import httpx

SCOPES = {
    "read": "https://www.googleapis.com/auth/gmail.readonly",
    "send": "https://www.googleapis.com/auth/gmail.send",
}
ENV_NAMES = {"read": "GMAIL_READ_REFRESH_TOKEN", "send": "GMAIL_SEND_REFRESH_TOKEN"}


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which not in SCOPES:
        print("usage: python -m agents.gmail_auth [read|send]")
        sys.exit(1)
    client_id = os.environ["GMAIL_OAUTH_CLIENT_ID"]
    client_secret = os.environ["GMAIL_OAUTH_CLIENT_SECRET"]

    state = secrets.token_urlsafe(16)
    result: dict[str, str] = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if qs.get("state", [""])[0] == state and "code" in qs:
                result["code"] = qs["code"][0]
                msg = b"Got it. You can close this tab."
            else:
                msg = b"Something didn't match. Close this tab and run the command again."
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(msg)

        def log_message(self, *_args) -> None:
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    redirect_uri = f"http://127.0.0.1:{server.server_port}"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": SCOPES[which], "access_type": "offline", "prompt": "consent", "state": state,
    })
    print(f"Opening Google sign-in for the {which} scope. If no browser opens, visit:\n{url}\n")
    webbrowser.open(url)
    while "code" not in result:
        server.handle_request()

    res = httpx.post("https://oauth2.googleapis.com/token", data={
        "code": result["code"], "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code",
    }, timeout=30)
    res.raise_for_status()
    token = res.json().get("refresh_token")
    if not token:
        print("Google didn't return a refresh token. Remove the app's access at "
              "myaccount.google.com/permissions and run this again.")
        sys.exit(1)
    print(f"Add this to the agent box's env (never commit it):\n{ENV_NAMES[which]}={token}")


if __name__ == "__main__":
    main()
