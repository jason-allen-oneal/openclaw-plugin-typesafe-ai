import { describe, it, expect } from "vitest";
import { redactSensitiveText, redactSensitivePayload } from "../src/redactor.js";

describe("redactSensitiveText", () => {
  it("masks API keys and access tokens", () => {
    const input = "Connecting with ts_live_1234567890abcdef1234567890 and sk-abcdef1234567890abcdef123456";
    const sanitized = redactSensitiveText(input);

    expect(sanitized).not.toContain("ts_live_");
    expect(sanitized).not.toContain("sk-");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it("masks Bearer tokens and Authorization headers", () => {
    const input = "Headers: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID";
    const sanitized = redactSensitiveText(input);

    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1Ni");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it("masks database passwords in connection strings", () => {
    const input = "Connecting to postgres://admin:SuperSecretPass123!@db.production.internal:5432/main";
    const sanitized = redactSensitiveText(input);

    expect(sanitized).not.toContain("SuperSecretPass123!");
    expect(sanitized).toContain("postgres://admin:[REDACTED_PASSWORD]@db.production.internal:5432/main");
  });

  it("masks private keys", () => {
    const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y...\n-----END RSA PRIVATE KEY-----";
    const sanitized = redactSensitiveText(input);

    expect(sanitized).not.toContain("MIIEowIBAAKCAQEA0Y");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });
});

describe("redactSensitivePayload", () => {
  it("deeply sanitizes nested objects containing sensitive field names", () => {
    const payload = {
      action: "deploy",
      credentials: {
        apiKey: "ts_live_secret1234567890abcdef",
        password: "MySuperSecretPassword",
        subObject: {
          token: "ghp_123456789012345678901234567890123456",
          normalField: "hello world",
        },
      },
      list: [
        { secret: "hidden_val" },
        "Bearer some_raw_bearer_token_12345",
      ],
    };

    const sanitized = redactSensitivePayload(payload) as any;

    expect(sanitized.action).toBe("deploy");
    expect(sanitized.credentials.apiKey).toBe("[REDACTED_SECRET]");
    expect(sanitized.credentials.password).toBe("[REDACTED_SECRET]");
    expect(sanitized.credentials.subObject.token).toBe("[REDACTED_SECRET]");
    expect(sanitized.credentials.subObject.normalField).toBe("hello world");
    expect(sanitized.list[0].secret).toBe("[REDACTED_SECRET]");
    expect(sanitized.list[1]).toContain("[REDACTED_SECRET]");
  });
});
