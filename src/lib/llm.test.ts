import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { z } from "zod";

// llm.ts reads its provider config at import time, so set the env first and import after.
const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
let llm: typeof import("./llm.js");
const sentBodies: Array<Record<string, unknown>> = [];

before(async () => {
  delete process.env.LLM_PROVIDER;
  process.env.OPENROUTER_API_KEY = "test-openrouter";
  process.env.GROQ_API_KEY = "test-groq";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ model: "google/gemma-4-31b-it", choices: [{ message: { content: '{"ok":true}' } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  llm = await import("./llm.js");
});

after(() => {
  globalThis.fetch = savedFetch;
  process.env = savedEnv;
});

describe("LLM providers on paid traffic", () => {
  it("doesn't fall back to Groq's free tier when an OpenRouter key is set", () => {
    assert.equal(llm.LLM_PROVIDER, "openrouter");
  });

  it("pins every OpenRouter request to Zero Data Retention endpoints", async () => {
    const result = await llm.extractViaOpenRouter("system", "user", z.object({ ok: z.boolean() }));
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(sentBodies.at(-1)?.provider, { zdr: true });
  });
});
