/**
 * Sensitive Data Redaction Pipeline for Privacy Scoping.
 * Strips secrets, tokens, credentials, and connection strings before any
 * data is transmitted to remote evaluation models.
 */

const SECRET_PATTERNS = [
  // Private Keys (RSA, EC, OpenSSH, PGP)
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gi,

  // Common API Keys and Tokens
  /\bts_live_[a-zA-Z0-9_-]{16,}\b/g,
  /\bts_test_[a-zA-Z0-9_-]{16,}\b/g,
  /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
  /\bghp_[a-zA-Z0-9]{36}\b/g,
  /\bgithub_pat_[a-zA-Z0-9_]{50,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  /\b[a-zA-Z0-9_-]{24}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27}\b/g, // Discord bot tokens

  // Bearer & Auth Tokens
  /\bBearer\s+[a-zA-Z0-9_\-.~+/]+=*/gi,
  /\b(basic|token)\s+[a-zA-Z0-9_\-.~+/]+=*/gi,
];

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "privatekey",
  "private_key",
  "secretkey",
  "secret_key",
  "authorization",
  "auth",
]);

/**
 * Redacts known sensitive patterns from raw string text.
 */
export function redactSensitiveText(text: string): string {
  if (!text || typeof text !== "string") return text;

  let sanitized = text;

  // Mask database credentials in connection strings
  sanitized = sanitized.replace(
    /(postgres|postgresql|mysql|mongodb|redis|amqp)(\+srv)?:\/\/([^:]+):([^@]+)@/gi,
    "$1$2://$3:[REDACTED_PASSWORD]@",
  );

  // Mask generic secret patterns
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
  }

  return sanitized;
}

/**
 * Deeply sanitizes JSON-serializable payloads by redacting sensitive object keys
 * and scrubbing sensitive string values.
 */
export function redactSensitivePayload(payload: unknown, depth = 0): unknown {
  if (depth > 10) return "[MAX_DEPTH_REACHED]";
  if (!payload || typeof payload !== "object") {
    if (typeof payload === "string") {
      return redactSensitiveText(payload);
    }
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactSensitivePayload(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_KEYS.has(lowerKey)) {
      result[key] = "[REDACTED_SECRET]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitivePayload(value, depth + 1);
    } else if (typeof value === "string") {
      result[key] = redactSensitiveText(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
