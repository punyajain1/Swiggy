import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GroqClient, parseRetryDelayMs } from "../src/ai/groq.js";
import { parseIntent } from "../src/ai/tasks.js";
import { FakeLlm, settings } from "./helpers.js";

const reply = (content: string) => ({ data: { choices: [{ message: { content } }] } });

function client(post: ReturnType<typeof vi.fn>) {
  return new GroqClient({ apiKey: "k", model: "openai/gpt-oss-120b", http: { post } as unknown as AxiosInstance });
}

const schema = z.object({ dish: z.string(), servings: z.number() });

describe("GroqClient.json", () => {
  it("returns validated JSON in JSON mode", async () => {
    const post = vi.fn().mockResolvedValue(reply('{"dish":"Butter Chicken","servings":4}'));
    const result = await client(post).json({ task: "t", system: "s", user: "u", schema });
    expect(result).toEqual({ dish: "Butter Chicken", servings: 4 });
    const body = post.mock.calls[0]![1];
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("openai/gpt-oss-120b");
  });

  it("retries once with the validation problem when the shape is wrong", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(reply('{"dish":"Butter Chicken"}'))
      .mockResolvedValueOnce(reply('{"dish":"Butter Chicken","servings":2}'));
    const result = await client(post).json({ task: "t", system: "s", user: "u", schema });
    expect(result.servings).toBe(2);
    expect(post).toHaveBeenCalledTimes(2);
    const retryMessages = post.mock.calls[1]![1].messages;
    expect(retryMessages.at(-1).content).toMatch(/servings/);
  });

  it("retries when the reply isn't JSON", async () => {
    const post = vi.fn().mockResolvedValueOnce(reply("not json")).mockResolvedValueOnce(reply('{"dish":"Dal","servings":1}'));
    await expect(client(post).json({ task: "t", system: "s", user: "u", schema })).resolves.toEqual({ dish: "Dal", servings: 1 });
  });

  it("gives up after the retry", async () => {
    const post = vi.fn().mockResolvedValue(reply('{"nope":true}'));
    await expect(client(post).json({ task: "t", system: "s", user: "u", schema })).rejects.toMatchObject({ code: "GROQ_ERROR" });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("explains a bad API key", async () => {
    const err = Object.assign(new Error("401"), { isAxiosError: true, response: { status: 401, data: {} } });
    const post = vi.fn().mockRejectedValue(err);
    await expect(client(post).json({ task: "t", system: "s", user: "u", schema })).rejects.toThrow(/GROQ_API_KEY/);
  });
});

describe("parseIntent", () => {
  const reply = (patch: Record<string, unknown>) => () => ({
    isFoodRequest: true,
    dishes: [{ name: "Butter Chicken", role: "main" }],
    servings: null,
    timeLimitMin: null,
    notes: null,
    ...patch,
  });

  it("uses the default servings when the sentence has none", async () => {
    const llm = new FakeLlm({ parseIntent: reply({}) });
    const intent = await parseIntent(llm, "I want butter chicken tonight", settings({ defaultServings: 3 }));
    expect(intent).toMatchObject({ dish: "Butter Chicken", servings: 3, servingsDefaulted: true, timeLimitMin: null });
  });

  it("keeps servings and time limit from the sentence", async () => {
    const llm = new FakeLlm({ parseIntent: reply({ servings: 4, timeLimitMin: 40 }) });
    const intent = await parseIntent(llm, "butter chicken for 4, 40 mins", settings());
    expect(intent).toMatchObject({ servings: 4, timeLimitMin: 40, servingsDefaulted: false });
  });

  it("keeps every dish of a meal", async () => {
    const llm = new FakeLlm({
      parseIntent: reply({
        dishes: [
          { name: "Paneer Butter Masala", role: "main" },
          { name: "Dal Makhani", role: "main" },
          { name: "Butter Naan", role: "bread" },
        ],
        servings: 6,
        timeLimitMin: 360,
      }),
    });
    const intent = await parseIntent(llm, "Paneer butter masala and daal makahni with butter naan for 6, I've got 6 hour", settings());
    expect(intent.dishes.map((d) => d.name)).toEqual(["Paneer Butter Masala", "Dal Makhani", "Butter Naan"]);
    expect(intent.dish).toBe("Paneer Butter Masala, Dal Makhani and Butter Naan");
    expect(intent).toMatchObject({ servings: 6, timeLimitMin: 360, droppedDishes: [] });
    // The prompt tells Groq to split on "and"/"with" and fix spellings.
    expect(llm.calls[0]!.system).toMatch(/EVERY distinct dish/);
  });

  it("removes duplicates and caps the meal at 4 dishes", async () => {
    const names = ["Dal Makhani", "dal makhani", "Jeera Rice", "Butter Naan", "Raita", "Gulab Jamun"];
    const llm = new FakeLlm({ parseIntent: reply({ dishes: names.map((name) => ({ name, role: "main" })) }) });
    const intent = await parseIntent(llm, "a big meal", settings());
    expect(intent.dishes.map((d) => d.name)).toEqual(["Dal Makhani", "Jeera Rice", "Butter Naan", "Raita"]);
    expect(intent.droppedDishes).toEqual(["Gulab Jamun"]);
  });

  it("rejects text that isn't a food request", async () => {
    const llm = new FakeLlm({ parseIntent: reply({ isFoodRequest: false, dishes: [] }) });
    await expect(parseIntent(llm, "what's the weather", settings())).rejects.toMatchObject({ status: 400 });
  });
});

describe("Groq rate limits (429)", () => {
  const limited = (message: string, headers: Record<string, string> = {}) =>
    Object.assign(new Error("429"), { isAxiosError: true, response: { status: 429, data: { error: { message } }, headers } });
  const MSG = "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 6601, Requested 1444. Please try again in 337.499999ms.";
  const withSleep = (post: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) => {
    const waits: number[] = [];
    const c = new GroqClient({
      apiKey: "k",
      model: "openai/gpt-oss-120b",
      http: { post } as unknown as AxiosInstance,
      sleepFn: async (ms) => void waits.push(ms),
      ...extra,
    });
    return { c, waits };
  };

  it("reads the wait Groq asks for, in every format it uses", () => {
    expect(parseRetryDelayMs(undefined, "Please try again in 337.499999ms.")).toBe(337);
    expect(parseRetryDelayMs(undefined, "Please try again in 2.5s.")).toBe(2500);
    expect(parseRetryDelayMs(undefined, "Please try again in 1m2.5s.")).toBe(62_500);
    expect(parseRetryDelayMs("3", "no hint here")).toBe(3000);
    expect(parseRetryDelayMs(undefined, "nothing useful")).toBeUndefined();
  });

  it("waits as long as Groq says, then retries and succeeds (the case from the logs)", async () => {
    const post = vi.fn().mockRejectedValueOnce(limited(MSG)).mockResolvedValueOnce(reply('{"dish":"Dal","servings":2}'));
    const { c, waits } = withSleep(post);
    await expect(c.json({ task: "t", system: "s", user: "u", schema })).resolves.toEqual({ dish: "Dal", servings: 2 });
    expect(post).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([337 + 250]);
  });

  it("keeps waiting across several 429s, up to the attempt limit", async () => {
    const post = vi.fn().mockRejectedValue(limited(MSG));
    const { c, waits } = withSleep(post, { maxRateLimitAttempts: 3 });
    await expect(c.json({ task: "t", system: "s", user: "u", schema })).rejects.toMatchObject({ code: "GROQ_ERROR" });
    expect(post).toHaveBeenCalledTimes(3);
    expect(waits).toHaveLength(2);
  });

  it("doesn't hang: a wait longer than the budget fails at once and says how long to wait", async () => {
    const post = vi.fn().mockRejectedValue(limited("Please try again in 1m2.5s."));
    const { c, waits } = withSleep(post);
    await expect(c.json({ task: "t", system: "s", user: "u", schema })).rejects.toThrow(/Try again in 63 s/);
    expect(post).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("uses the retry-after header when there is one", async () => {
    const post = vi.fn().mockRejectedValueOnce(limited("limit", { "retry-after": "2" })).mockResolvedValueOnce(reply('{"dish":"Dal","servings":1}'));
    const { c, waits } = withSleep(post);
    await c.json({ task: "t", system: "s", user: "u", schema });
    expect(waits).toEqual([2250]);
  });

  it("other errors are not retried", async () => {
    const err = Object.assign(new Error("500"), { isAxiosError: true, response: { status: 500, data: { error: { message: "boom" } }, headers: {} } });
    const post = vi.fn().mockRejectedValue(err);
    const { c } = withSleep(post);
    await expect(c.json({ task: "t", system: "s", user: "u", schema })).rejects.toThrow(/boom/);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
