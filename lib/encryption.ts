import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer {
  const hex = process.env.MESSAGE_ENCRYPTION_KEY?.trim();
  if (!hex || hex.length !== 64) {
    throw new Error(
      `MESSAGE_ENCRYPTION_KEY must be a 64-char hex string (got ${hex?.length ?? 0} chars). Generate one with: openssl rand -hex 32`
    );
  }
  return Buffer.from(hex, "hex");
}

// Returns "<iv>.<authTag>.<ciphertext>" as base64url segments.
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

// Inverse of encrypt(). Throws if tampered or key mismatch.
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted message format");
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
