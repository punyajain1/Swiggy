import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = "v1";

function toKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return key;
}

/** Encrypts text with AES-256-GCM. Output: "v1:<iv>:<tag>:<ciphertext>", each part base64url. */
export function encrypt(plaintext: string, keyBase64: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, toKey(keyBase64), iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

/** Decrypts a value produced by `encrypt`. Throws if the data was tampered with or the key is wrong. */
export function decrypt(payload: string, keyBase64: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Malformed encrypted payload");
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv(ALGORITHM, toKey(keyBase64), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}
