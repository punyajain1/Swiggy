import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { testKey } from "./helpers.js";

describe("AES-256-GCM", () => {
  it("round-trips", () => {
    const key = testKey();
    const enc = encrypt("secret-token", key);
    expect(enc).not.toContain("secret-token");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decrypt(enc, key)).toBe("secret-token");
  });

  it("uses a fresh IV each time", () => {
    const key = testKey();
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("fails on tampered ciphertext", () => {
    const key = testKey();
    const parts = encrypt("secret-token", key).split(":");
    const data = Buffer.from(parts[3]!, "base64url");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64url");
    expect(() => decrypt(parts.join(":"), key)).toThrow();
  });

  it("fails with the wrong key", () => {
    const enc = encrypt("secret-token", testKey());
    expect(() => decrypt(enc, testKey())).toThrow();
  });
});

describe("env validation", () => {
  const valid = {
    DATABASE_URL: "postgresql://u:p@h/db",
    GROQ_API_KEY: "gsk_x",
    TOKEN_ENC_KEY: testKey(),
  };

  it("accepts a valid env and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.GROQ_MODEL).toBe("openai/gpt-oss-120b");
    expect(env.SWIGGY_REDIRECT_URL).toBe("http://localhost:4000/auth/callback");
  });

  it("lists every missing variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*GROQ_API_KEY[\s\S]*TOKEN_ENC_KEY/);
  });

  it("rejects a key that isn't 32 bytes", () => {
    expect(() => parseEnv({ ...valid, TOKEN_ENC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
  });
});
