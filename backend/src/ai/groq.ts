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
 * Groq client over its OpenAI-compatible REST API, using axios and JSON mode.
 * If the reply isn't valid JSON or fails the schema, it retries once and tells the
 * model exactly what was wrong.
 */
export class GroqClient implements JsonLlm {
  private readonly http: AxiosInstance;

  constructor(
    private readonly opts: { apiKey: string; model: string; timeoutMs?: number; http?: AxiosInstance },
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
        logger.warn({ status, message }, "Groq request failed");
        if (status === 401) throw errors.upstream("groq", "Groq rejected the API key. Check GROQ_API_KEY.");
        if (status === 429) throw errors.upstream("groq", "Groq rate limit reached. Try again in a minute.");
        if (status === 400 && /json/i.test(message)) return ""; // JSON-mode generation failure: let the caller retry.
        throw errors.upstream("groq", `Groq request failed: ${message}`);
      }
      throw errors.upstream("groq", `Groq request failed: ${(err as Error).message}`);
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
