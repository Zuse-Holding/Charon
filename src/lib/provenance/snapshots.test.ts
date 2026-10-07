import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

// The recorder wraps globalThis.fetch when first used, so a stub goes in
// first and the module is loaded after it.
const realFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push(url);
  return new Response(`body of ${new URL(url).pathname}`, { status: url.includes("missing") ? 404 : 200, headers: { "content-type": "text/plain" } });
}) as typeof fetch;

const { recordSnapshots, redactUrl, sha256 } = await import("./snapshots.js");

describe("snapshot recorder", () => {
  before(() => { calls.length = 0; });
  after(() => { globalThis.fetch = realFetch; });

  it("does nothing when the flag is off", async () => {
    const { value, snapshots } = await recordSnapshots(false, async () => (await fetch("https://acme.com/a")).text());
    assert.equal(value, "body of /a");
    assert.equal(snapshots, null);
  });

  it("records source responses with their hash, and leaves the response readable", async () => {
    const { value, snapshots } = await recordSnapshots(true, async () => {
      const r = await fetch("https://acme.com/team");
      await fetch("https://acme.com/missing");
      return r.text();
    });
    assert.equal(value, "body of /team");
    assert.equal(snapshots!.length, 2);
    assert.equal(snapshots![0].sha256, sha256("body of /team"));
    assert.equal(snapshots![0].host, "acme.com");
    assert.equal(snapshots![1].status, 404);
  });

  it("skips LLM providers and our own infrastructure", async () => {
    const { snapshots } = await recordSnapshots(true, async () => {
      await fetch("https://openrouter.ai/api/v1/chat/completions");
      await fetch("https://abc.supabase.co/rest/v1/research_runs");
      await fetch("https://api.groq.com/openai/v1/chat/completions");
    });
    assert.equal(snapshots!.length, 0);
  });

  it("keeps concurrent runs apart and records nothing outside a run", async () => {
    const [a, b] = await Promise.all([
      recordSnapshots(true, async () => { await fetch("https://one.com/x"); }),
      recordSnapshots(true, async () => { await fetch("https://two.com/y"); }),
    ]);
    await fetch("https://three.com/z");
    assert.deepEqual(a.snapshots!.map((s) => s.host), ["one.com"]);
    assert.deepEqual(b.snapshots!.map((s) => s.host), ["two.com"]);
  });

  it("never stores credentials from the query string", () => {
    const u = redactUrl("https://api.example.com/search?q=acme&api_key=SECRET&subscription-key=x&token=abc");
    assert.ok(!u.includes("SECRET") && !u.includes("token=abc") && !u.includes("subscription-key=x"));
    assert.ok(u.includes("q=acme"));
  });
});
