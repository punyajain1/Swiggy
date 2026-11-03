import axios, { type AxiosInstance, isAxiosError } from "axios";
import type { z } from "zod";
import { errors } from "../errors.js";
import { logger } from "../logger.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonCompletionOptions<S extends z.ZodType> {
  /** Short label for logs, e.g. "parseIntent". */
  task: string;
  system: string;
  user: string;
  schema: S;
  temperature?: number;
  maxTokens?: number;
}

/** Anything that can return validated JSON from a prompt. Tests swap in a fake. */
export interface JsonLlm {
  json<S extends z.ZodType>(opts: JsonCompletionOptions<S>): Promise<z.infer<S>>;
}

/**
 * How long Groq asks us to wait after a 429, in ms. It sends a `retry-after` header (seconds) and
 * also says it in the message: "Please try again in 337.499999ms", "in 2.5s" or "in 1m2.5s".
 */
export function parseRetryDelayMs(retryAfterHeader: unknown, message: string): number | undefined {
  const header = Number(retryAfterHeader);
  if (retryAfterHeader !== undefined && retryAfterHeader !== null && retryAfterHeader !== "" && Number.isFinite(header) && header >= 0) {
    return Math.round(header * 1000);
  }
  const m = /try again in\s+((?:\d+(?:\.\d+)?\s*[hms]+\s*)+)/i.exec(message);
  if (!m) return undefined;
  let ms = 0;
  for (const part of m[1]!.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi)) {
    const n = Number(part[1]);
    const unit = part[2]!.toLowerCase();
    ms += unit === "ms" ? n : unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : n * 3_600_000;
  }
  return ms > 0 ? Math.round(ms) : undefined;
}

/**
 * Groq client over its OpenAI-compatible REST API, using axios and JSON mode.
 * - If the reply isn't valid JSON or fails the schema, it retries once and tells the
 *   model exactly what was wrong.
 * - On a 429 (rate limit) it waits as long as Groq says and tries again, up to a few times and a
 *   total wait budget, since limits are per minute and a short wait usually clears them. If the wait
 *   is longer than the budget it gives up at once, so the request doesn't hang.
 */
export class GroqClient implements JsonLlm {
  private readonly http: AxiosInstance;

  constructor(
    private readonly opts: {
      apiKey: string;
      model: string;
      timeoutMs?: number;
      http?: AxiosInstance;
      /** Most times one call is sent when Groq keeps answering 429. Default 4. */
      maxRateLimitAttempts?: number;
      /** Most total time spent waiting on 429s for one call. Default 20 s. */
      rateLimitBudgetMs?: number;
      sleepFn?: (ms: number) => Promise<void>;
    },
  ) {
    this.http =
      opts.http ??
      axios.create({
        baseURL: "https://api.groq.com/openai/v1",
        timeout: opts.timeoutMs ?? 30_000,
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      });
  }

  private async complete(messages: ChatMessage[], temperature: number, maxTokens: number): Promise<string> {
    const isReasoningModel = this.opts.model.startsWith("openai/gpt-oss");
    const maxAttempts = this.opts.maxRateLimitAttempts ?? 4;
    const budgetMs = this.opts.rateLimitBudgetMs ?? 20_000;
    const sleepFn = this.opts.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let waitedMs = 0;

    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.http.post("/chat/completions", {
          model: this.opts.model,
          messages,
          temperature,
          max_completion_tokens: maxTokens,
          response_format: { type: "json_object" },
          // gpt-oss models reason before answering; keep it short and out of the reply.
          ...(isReasoningModel ? { reasoning_effort: "low", include_reasoning: false } : {}),
        });
        const content: unknown = res.data?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new Error("empty reply");
        return content;
      } catch (err) {
        if (isAxiosError(err)) {
          const status = err.response?.status;
          const message =
            (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
          if (status === 429) {
            const asked = parseRetryDelayMs(err.response?.headers?.["retry-after"], message);
            // A little extra so the wait isn't cut exactly at the edge of the window.
            const wait = Math.min(60_000, (asked ?? 2000) + 250);
            if (attempt < maxAttempts && waitedMs + wait <= budgetMs) {
              logger.info({ attempt, waitMs: wait, message }, "Groq rate limit; waiting then retrying");
              waitedMs += wait;
              await sleepFn(wait);
              continue;
            }
            logger.warn({ status, attempt, waitedMs, asked, message }, "Groq rate limit; giving up");
            const when = asked !== undefined ? ` Try again in ${Math.max(1, Math.ceil(asked / 1000))} s.` : " Try again in a minute.";
            throw errors.upstream("groq", `Groq is rate-limiting this app.${when}`);
          }
          logger.warn({ status, message }, "Groq request failed");
          if (status === 401) throw errors.upstream("groq", "Groq rejected the API key. Check GROQ_API_KEY.");
          if (status === 400 && /json/i.test(message)) return ""; // JSON-mode generation failure: let the caller retry.
          throw errors.upstream("groq", `Groq request failed: ${message}`);
        }
        throw errors.upstream("groq", `Groq request failed: ${(err as Error).message}`);
      }
    }
  }

  async json<S extends z.ZodType>(opts: JsonCompletionOptions<S>): Promise<z.infer<S>> {
    const messages: ChatMessage[] = [
      { role: "system", content: `${opts.system}\n\nRespond with a single JSON object only.` },
      { role: "user", content: opts.user },
    ];
    const temperature = opts.temperature ?? 0.2;
    const maxTokens = opts.maxTokens ?? 4096;

    let lastProblem = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await this.complete(messages, temperature, maxTokens);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        lastProblem = "The reply was not valid JSON.";
        messages.push({ role: "assistant", content: raw || "(empty)" }, { role: "user", content: `${lastProblem} Reply again with valid JSON only.` });
        continue;
      }
      const result = opts.schema.safeParse(parsedJson);
      if (result.success) return result.data;
      lastProblem = result.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      logger.debug({ task: opts.task, lastProblem }, "Groq reply failed validation");
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: `That JSON did not match the required shape: ${lastProblem}. Fix it and reply with the full corrected JSON only.` },
      );
    }
    throw errors.upstream("groq", `The AI gave an unusable answer for ${opts.task}.`, { problem: lastProblem });
  }
}
