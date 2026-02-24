import crypto from "crypto";
import { config } from "../lib/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keySource = config.encryption.tokenEncryptionKey || config.encryption.sessionSecret;

  if (!keySource) {
    console.error("[TokenEncryption] SECURITY WARNING: No TOKEN_ENCRYPTION_KEY or SESSION_SECRET found!");
    throw new Error("Encryption key not configured. Set TOKEN_ENCRYPTION_KEY or SESSION_SECRET environment variable.");
  }

  return crypto.scryptSync(keySource, "shopify-token-salt", 32);
}

export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, "hex")]);
  return "enc:" + combined.toString("base64");
}

export function decryptToken(encryptedToken: string): string {
  if (!encryptedToken.startsWith("enc:")) {
    return encryptedToken;
  }

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedToken.slice(4), "base64");

    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error("Invalid encrypted token format");
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted.toString("hex"), "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("[TokenEncryption] Failed to decrypt token:", error instanceof Error ? error.message : "Unknown error");
    throw new Error("Token decryption failed - token may be corrupted or encrypted with different key");
  }
}

export function isTokenEncrypted(token: string): boolean {
  return token.startsWith("enc:");
}
