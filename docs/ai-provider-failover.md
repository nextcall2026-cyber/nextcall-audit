# AI Provider Failover — Google Gemini (primary) → OpenAI (fallback)

**Status:** implemented · **Date:** 2026-10-14 · **Scope:** all AI features in `nextcall_marketing_app`

## What changed

Previously every AI feature talked to OpenAI directly through a single client
factory (`getOpenAIClient()`), with the model hardcoded as `gpt-4o-mini`.

Now all AI traffic goes through one gateway (`src/lib/ai/`) that routes to
**Google Gemini first** and switches to **OpenAI automatically** whenever
Gemini fails — including when Gemini runs out of credit/quota. Call sites no
longer know or care which vendor served the request.

## Architecture

```
 call sites                          LLM gateway (src/lib/ai/index.ts)
┌─────────────────────────┐        ┌────────────────────────────────────────────┐
│ aiReportService         │        │ 1. Google Gemini   ── success ──▶ return   │
│ aiFollowupService       │───────▶│    (gemini-3.6-flash)                      │
│ /api/extract-screenshot │        │        │ failure                            │
└─────────────────────────┘        │        ▼                                   │
                                   │ 2. OpenAI          ── success ──▶ return   │
                                   │    (gpt-4o-mini)      [fallback: true]     │
                                   │        │ failure (or provider skipped      │
                                   │        ▼  by circuit breaker)              │
                                   │    throw LLMUnavailableError               │
                                   └────────────────────────────────────────────┘
                                                 │
                                      ┌──────────▼──────────┐
                                      │ Circuit breaker     │
                                      │ (per provider)      │
                                      └─────────────────────┘
```

- `src/lib/ai/index.ts` — gateway: provider chain, routing, `getLLMStatus()`
- `src/lib/ai/gemini.ts` — Gemini REST provider (`x-goog-api-key`, inline images, JSON mode)
- `src/lib/ai/openaiProvider.ts` — OpenAI SDK provider (fallback)
- `src/lib/ai/breaker.ts` — circuit breaker with per-error cooldowns
- `src/lib/ai/types.ts` — shared request/response/error types

## When does the fallback activate?

Any Gemini failure moves the request to OpenAI immediately — no retries bought
with user-visible latency:

| Gemini failure | Detected as | Breaker cooldown¹ |
| --- | --- | --- |
| Out of credit / free-tier quota exhausted (HTTP 429 `RESOURCE_EXHAUSTED`, quota-style message) | `quota` | 10 min |
| Rejected / invalid API key (401/403) | `auth` | 10 min |
| Per-minute rate limit (429, rate-limit message) | `rate-limit` | 60 s |
| 5xx, timeout (30 s), network error | `transient` | 60 s |
| Safety block / empty response | `blocked` / `empty` | none (request-specific) |
| Other 4xx (bad request shape) | `bad-request` | none |

¹ While a cooldown is active, the gateway **skips** that provider entirely
(the breaker is "open") so requests don't pay the failing provider's latency;
after the cooldown it is tried again automatically. A success resets the
breaker. State is in-memory per server process.

When the request is served by the fallback, the logs contain:
`[LLMGateway] Request served by FALLBACK OpenAI (gpt-4o-mini); primary Google Gemini was unavailable.`

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Primary provider. Supports legacy `AIza...` and new AI Studio `AQ....` keys |
| `OPENAI_API_KEY` | — | Fallback provider |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Override the Gemini model |
| `OPENAI_MODEL` | `gpt-4o-mini` | Override the OpenAI model |

Both keys are optional: with only one key configured the app runs on that
provider alone; with neither, AI routes return a clear
"no LLM provider is configured" error.

Keys can live in `.env` (gitignored) **or** as OS environment variables —
Next.js reads both. As of 2026-10-14, `GEMINI_API_KEY` is configured as a
Windows **user environment variable** (set via `setx`), which the platform's
file-write policy requires because it refuses to write secret literals into
files. It takes effect in **new terminal sessions**; remove it with
`[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", $null, "User")`.
If the key is ever also pasted into `.env`, the existing environment variable
wins (Next.js does not override variables already present in the environment).

**Active model overrides on this machine (2026-10-14, via user env vars):**

- `GEMINI_MODEL=gemini-3.8-flash` — verified live with the project key
  (JSON mode + thinking disabled). One transient 503 "high demand" was
  observed on the first call and succeeded on retry; the gateway's transient
  classification (60 s breaker + OpenAI fallback) covers such spikes.
- `OPENAI_MODEL` unset → falls back to `gpt-4o-mini`. `gpt-6-luna` **is listed
  for the OpenAI key** but was not activated: the OpenAI account had zero
  credits at verification time, so a live invocation test was impossible, and
  modern OpenAI model families may reject legacy `max_tokens`/`temperature`
  parameters. To switch after adding credits: `setx OPENAI_MODEL gpt-6-luna`,
  restart, and watch the first fallback call (a compat shim for modern
  parameters is already stubbed as a skipped test in
  `src/lib/__tests__/aiOpenAIProvider.test.ts`).

### Model choices (verified 2026-10-14)

- `gemini-3.6-flash` — current stable general-purpose Flash model; accessible
  with the project key; multimodal (handles the screenshot-extraction vision
  path). `gemini-2.5-flash` is retiring Oct 20, 2026, hence not the default.
- Gemini 3.x "thinks" by default, which burns output-token budget before the
  answer. The gateway disables thinking (`thinkingBudget: 0`) by default and
  uses a small budget (`thinkingLevel: "low"`) only for the long-form audit
  report — keeping behavior parity with the non-reasoning `gpt-4o-mini`.

## Call-site API

```ts
const llm = await generateLLMResponse({
  system, user,
  images: [{ mimeType: "image/png", data: base64 }], // optional (vision)
  temperature: 0.5,
  maxOutputTokens: 1500,
  json: true,
  thinking: "low", // "off" (default) | "low"
});
llm.text;      // model output
llm.provider;  // "gemini" | "openai"
llm.model;
llm.fallback;  // true when the primary was unavailable
```

## Observability

`GET /api/providers/health` now includes an `llm` section:

```json
{ "llm": [
  { "id": "gemini", "role": "primary", "configured": true, "model": "gemini-3.6-flash",
    "circuit": "open", "cooldownRemainingMs": 412000, "lastErrorKind": "quota", "lastErrorMessage": "..." },
  { "id": "openai", "role": "fallback", "configured": true, "model": "gpt-4o-mini", "circuit": "closed" }
] }
```

The settings page's "AI Provider" card shows both providers' configuration
status (Google Gemini primary / OpenAI fallback).

## Tests

`npx vitest run src/lib/__tests__/aiGateway.test.ts src/lib/__tests__/aiProviders.test.ts`

Covers: primary-first routing, fallback on quota failure, breaker skip +
recovery, zero-cooldown error behavior, all-providers-down error, health
report, request mapping to the Gemini REST format (system/vision/JSON/thinking
config), and error classification for both vendors.

## Runbook

**Gemini runs out of credit.**
Users notice nothing: requests flow to OpenAI from the first failure onward.
Logs show the `[LLMGateway] ... failed [quota]` warning and the FALLBACK
notice. After ~10 min the gateway probes Gemini again; if credit is restored,
traffic returns to Gemini automatically (breaker resets on the first success).

**A key is rotated.**
Update `.env` or the Windows user env var (`setx GEMINI_API_KEY "..."`) and
restart the dev/prod process **from a new terminal**. An invalid key parks that
provider for 10 min; a restart clears breaker state immediately.

**Priority is reversed (OpenAI primary) or a third provider is added.**
Edit `buildProviderChain()` in `src/lib/ai/index.ts` — order defines priority;
each provider only needs to implement `LLMProvider` (`id`, `label`, `model`,
`isConfigured()`, `complete()`).

## Security notes

- API keys live in `.env` (gitignored) and/or OS user environment variables —
  never in source files. The `.env.example` template was removed at the
  user's request; the env contract is the configuration table above.
- The Gemini key used during implementation was shared in chat/screenshots;
  rotate it in AI Studio when convenient, update `.env`, and restart.
- Since June 19, 2026 the Gemini API rejects *unrestricted* API keys. Keys
  generated directly in AI Studio (including `AQ....` keys) are restricted to
  the Gemini API by default — keep it that way; never create unrestricted keys.
