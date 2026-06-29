export {};

import "dotenv/config";

/**
 * Run with: npx tsx src/diagnose-ollama.ts
 * Tests Ollama connectivity from Node.js and prints exactly what fails.
 */
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

console.log(`OLLAMA_URL env:   ${process.env.OLLAMA_URL ?? "(not set, using default)"}`);
console.log(`OLLAMA_MODEL env: ${process.env.OLLAMA_MODEL ?? "(not set, using default)"}`);
console.log(`Testing Ollama at: ${OLLAMA_URL}`);
console.log(`Model: ${OLLAMA_MODEL}`);
console.log("---");

// Step 1: tags endpoint (availability check)
console.log("Step 1: GET /api/tags ...");
try {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  console.log(`  HTTP status: ${res.status}`);
  const body = await res.text();
  console.log(`  Body: ${body.slice(0, 300)}`);
} catch (err) {
  console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// Step 2: minimal generate call
console.log("\nStep 2: POST /api/generate (minimal test) ...");
try {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: 'Return this exact JSON: {"ok":true}',
      format: "json",
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`  HTTP status: ${res.status}`);
  const body = await res.text();
  console.log(`  Body: ${body.slice(0, 500)}`);
} catch (err) {
  console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log("\nStep 3: Testing isOllamaAvailable() from lib/llm.ts ...");
const { isOllamaAvailable, extractStructured, CompanyExtractionSchema } = await import("./lib/llm.js");
const available = await isOllamaAvailable();
console.log(`  isOllamaAvailable() returned: ${available}`);

if (available) {
  console.log("\nStep 4: Testing extractStructured() with real schema ...");
  const result = await extractStructured(
    "Extract company facts as JSON.",
    "Stripe was founded in 2010 by Patrick Collison and John Collison. Headquarters: South San Francisco.",
    CompanyExtractionSchema
  );
  console.log(`  Result: ${JSON.stringify(result)}`);
}

console.log("\nAll steps passed.");
