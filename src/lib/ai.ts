import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in environment variables.");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: 30000,
      maxRetries: 1,
    });
  }

  return openaiClient;
}