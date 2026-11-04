/**
 * The ONE routing chain, by the exact name configured in FreeLLMAPI.
 *
 * Every AI task in the app — screenshot reading, the audit report, follow-up
 * drafts — goes through this single chain. There are deliberately no per-task
 * chains any more: one pool of tokens, one queue of models, fastest model
 * first (the order lives in the FreeLLMAPI dashboard, not in this codebase).
 * A heavy task simply waits behind the others instead of silently burning a
 * second account's free tier.
 *
 * The name must match the router dashboard character for character (including
 * the "auto:" prefix); a typo shows up as a 400 from the router, not as a
 * silent fallback. Rename without a code change via the AI_MAIN_CHAIN env var.
 */

const DEFAULT_MAIN_CHAIN = "auto:main";

const configured = (process.env.AI_MAIN_CHAIN ?? "").trim();

export const AI_CHAINS = {
  main: configured || DEFAULT_MAIN_CHAIN,
} as const;

export type AiChainName = (typeof AI_CHAINS)[keyof typeof AI_CHAINS];
