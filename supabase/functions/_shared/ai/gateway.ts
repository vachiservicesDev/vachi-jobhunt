import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, log } from "../http.ts";

/**
 * AI gateway (ARCHITECTURE.md section 6). Every model call goes through runTask so
 * routing, validation, refusal handling and metering live in one place.
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TaskSpec<T extends z.ZodType> {
  task: string;               // e.g. "resume.parse"
  promptVersion: string;      // bump on any prompt change; logged with every call
  system: string;
  schema: T;
  effort: Effort;
  maxTokens: number;
}

const DEFAULT_MODEL = "claude-opus-5-5";
// Per-million-token prices used for cost logging; keep in sync with the provider's pricing page.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") }));

/** Model is configurable per task without a deploy of the app: AI_MODEL_RESUME_PARSE etc. */
export function modelFor(task: string): string {
  return Deno.env.get(`AI_MODEL_${task.replace(/\W/g, "_").toUpperCase()}`) ?? DEFAULT_MODEL;
}

export async function runTask<T extends z.ZodType>(
  db: SupabaseClient,
  userId: string | null,
  spec: TaskSpec<T>,
  /** Untrusted content (resumes, job descriptions) goes here, never into `system`. */
  input: string,
): Promise<z.infer<T>> {
  const model = modelFor(spec.task);
  const started = Date.now();
  let usage = { input_tokens: 0, output_tokens: 0 };
  let ok = false;
  let errorCode: string | null = null;
  try {
    const res = await anthropic().messages.parse({
      model,
      max_tokens: spec.maxTokens,
      system: spec.system,
      output_config: { effort: spec.effort, format: zodOutputFormat(spec.schema) },
      messages: [{ role: "user", content: `<document>\n${input}\n</document>` }],
    });
    usage = res.usage;
    if (res.stop_reason === "refusal") throw new HttpError(422, "ai_refused", "We couldn't process this content.");
    if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new HttpError(502, "ai_incomplete", "The AI response was incomplete.");
    ok = true;
    return res.parsed_output as z.infer<T>;
  } catch (e) {
    errorCode = e instanceof HttpError ? e.code : e instanceof Anthropic.RateLimitError ? "rate_limited" : e instanceof Anthropic.APIError ? `api_${e.status}` : "unknown";
    throw e instanceof HttpError ? e : new HttpError(502, "ai_unavailable", "The AI service is busy. Try again shortly.");
  } finally {
    const price = PRICES[model] ?? { in: 0, out: 0 };
    const cost = (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1_000_000;
    const row = {
      user_id: userId, task: spec.task, provider: "anthropic", model, prompt_version: spec.promptVersion,
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost,
      latency_ms: Date.now() - started, ok, error_code: errorCode,
    };
    const { error } = await db.schema("ai").from("usage_log").insert(row);
    if (error) log({ msg: "usage_log insert failed", error: error.message });
  }
}
