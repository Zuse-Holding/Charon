# AI providers serving paid traffic

Checked 2026-10-11. Not legal advice; links go to the source text.

## What serves a paid research report

Every agent calls one function, `extractStructured()` in `src/lib/llm.ts`. In order:

| Step | Provider | Model(s) | Tier | When |
|---|---|---|---|---|
| 1 | OpenRouter | `google/gemma-4-31b-it` → `mistralai/mistral-small-3.2-24b-instruct` → `google/gemini-2.5-flash-lite` | Paid (prepaid credit) | Always, when `OPENROUTER_API_KEY` is set |
| 2 | Groq | `openai/gpt-oss-20b` | **Free** (8K tokens/min; Developer upgrade unavailable) | Only if `LLM_PROVIDER=groq`. Before this change it ran automatically whenever `GROQ_API_KEY` was set. |
| 3 | Ollama | `llama3.1:8b` | Local, $0 | Dev only, no-op in production |

If every step fails, agents fall back to their non-LLM heuristics, so a report still completes.

Not paid traffic: Selene (`agents/`) and the ops dashboard chat use Groq or Ollama for internal tools only.

## OpenRouter

- **Commercial use:** allowed. Section 10.2 asks anyone using it "for commercial, for-profit purposes" to review the DPA. Rights in outputs follow each model's own terms (§6.1), and you're responsible for reviewing those (§5.1). [Terms](https://openrouter.ai/terms)
- **OpenRouter's own retention:** prompts aren't stored unless you opt in to prompt logging (§6.5: "Unless explicitly opted in to prompt logging, we do not store your Inputs after categorizing them"). OpenRouter doesn't train on inputs or outputs. [Privacy](https://openrouter.ai/privacy)
- **Upstream providers:** each provider has its own retention and training policy, and OpenRouter makes no promise about them (§16.2).
  - **This is now handled in code:** every request sends `provider: { zdr: true }`, so it only routes to Zero Data Retention endpoints. [Routing docs](https://openrouter.ai/docs/features/provider-routing)
  - I tested all three models live with that filter on 2026-10-11. All three answered (DeepInfra / Venice / Google).
- **Account settings to confirm (Nick):**
  - Prompt logging is **off**.
  - "Allow providers that may train on inputs" is **off** for paid models (openrouter.ai/settings/privacy).
- **Second key (`OPENROUTER_API_KEY_2`):** the code supports a second account's key. It was originally added to stack free-tier rate limits. Now that only paid models are used, it isn't needed for that. If a second account still exists for that reason, retire it. Splitting traffic across accounts to get around limits is the kind of use providers' terms prohibit (Groq's §6.3(d)(iii) says this explicitly).

## Groq

- **Commercial use:** GroqCloud is governed by the [Services Agreement](https://console.groq.com/docs/legal/services-agreement), not the website Terms of Use (those are "personal, non-commercial" but exclude cloud services).
  - The agreement allows integrating the service into your applications for end users (§3.1), and says services "are not for consumer use."
  - Free ("fee-free") services cap Groq's liability at $5,000 (§14.2).
  - It prohibits use "in a manner intended to avoid incurring Fees" (§6.3(d)(iii)).
- **Training:** Groq "is not permitted to use Inputs or Outputs for training or fine-tuning" without your permission (§4.2).
- **Retention:** no inputs or outputs are kept by default. Temporary logs for reliability or abuse investigations are kept up to 30 days. Zero Data Retention can be turned on in Console → Data Controls. Data is stored in US GCP. Customer data is deleted within 30 days of termination (§11.5). [Your data](https://console.groq.com/docs/your-data)
- **Why it's off paid traffic:** it's a free tier with an 8K tokens/min cap and no upgrade path available to us. If you turn it back on with `LLM_PROVIDER=groq`, enable ZDR in Data Controls first.

## For Nick

1. Check that production (Vercel and Railway) doesn't set `LLM_PROVIDER=groq`. If it does, that env var overrides this change.
2. In OpenRouter settings: prompt logging off, training providers off for paid models.
3. Decide whether to keep the Groq key in production at all. It's unused for reports now unless opted in.
4. The privacy page already names Groq and OpenRouter and says providers may keep requests under their own terms. With ZDR routing that is now stricter than the page says, which is fine, but you could tighten the wording once the attorney reviews it.
