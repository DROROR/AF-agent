import { describe, expect, it } from "vitest";
import { isSecretKeyName, redactLines, redactSecrets, redactStructured } from "./redact.js";

describe("redactSecrets", () => {
  it("redacts a worker token in a key=value log line", () => {
    const line = 'worker starting workerToken=9f3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c workerId=accd0a71';
    const redacted = redactSecrets(line);
    expect(redacted).not.toContain("9f3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c");
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("workerId=accd0a71");
  });

  it("redacts DATABASE_URL-style inline credentials but keeps the host readable", () => {
    const redacted = redactSecrets("DATABASE_URL=postgresql://dyo_app:s3cr3tpw@127.0.0.1:5432/dyo_video_agent");
    expect(redacted).not.toContain("s3cr3tpw");
  });

  it("redacts credentials embedded in a URL under an unrecognized key name", () => {
    const redacted = redactSecrets("upstream https://svcuser:hunter2@api.example.com/v1");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("svcuser");
    expect(redacted).toContain("api.example.com");
  });

  it("redacts a JWT even when no key name hints at a secret", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const redacted = redactSecrets(`authorization header carried ${jwt} today`);
    expect(redacted).not.toContain(jwt);
  });

  it("redacts an Authorization: Bearer header value", () => {
    const redacted = redactSecrets("authorization: Bearer abc123def456ghi789jkl012mno345pqr678stu");
    expect(redacted).not.toContain("abc123def456ghi789jkl012mno345pqr678stu");
  });

  // REAL 2026-09-12 false positive: this came back as "[REDACTED]" during an
  // incident whose entire question was which build the machine was running.
  it("NEVER redacts a 40-char git commit SHA - it identifies the running build", () => {
    const sha = "86f300882164b32f0a0b49d76c71da02948d66ee";
    expect(redactSecrets(`{"buildInfo":{"commit":"${sha}"}}`)).toContain(sha);
  });

  it("still redacts a 40-char run that is NOT hex - that shape is not a digest", () => {
    const token = "zzTOKENzz1234567890abcdefghijklmnopqrstu";
    expect(redactSecrets(`opaque ${token}`)).not.toContain(token);
  });

  it("NEVER redacts a sha256 digest - real, non-secret integrity evidence this project depends on", () => {
    const sha = "93a47daf8c65bbde29dda6dcc66cffc5d95838d5508afabb518413528c180dc7";
    expect(redactSecrets(`package sha256 ${sha}`)).toContain(sha);
  });

  it("keeps ordinary operational log text intact", () => {
    const line = '{"msg":"heartbeat succeeded","aeStatus":"ONLINE","mcpStatus":"ONLINE"}';
    expect(redactSecrets(line)).toBe(line);
  });

  it("redacts every line of a tail", () => {
    const out = redactLines(["password=abc", "ordinary line"]);
    expect(out[0]).not.toContain("abc");
    expect(out[1]).toBe("ordinary line");
  });

  // The exact hole found on 2026-09-12: worker.log is JSON, so a secret key
  // is followed by a closing quote before its colon. This must be redacted by
  // KEY NAME, never left to the shape-based fallback - a secret that happens
  // to look like a digest would otherwise leak.
  it("redacts a JSON-quoted secret key even when the value is digest-shaped", () => {
    const fortyHexToken = "9f3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c";
    const line = `{"msg":"starting","workerToken":"${fortyHexToken}"}`;
    expect(redactSecrets(line)).not.toContain(fortyHexToken);
  });

  it("redacts a JSON-quoted password whose value is far too short to look opaque", () => {
    expect(redactSecrets('{"password":"hunter2"}')).not.toContain("hunter2");
  });
});

describe("redactStructured", () => {
  it("replaces a value under a secret-named key even when the value looks harmless", () => {
    const out = redactStructured({ password: "hunter2", workerName: "FAHADNAKASH" }) as Record<string, unknown>;
    expect(out["password"]).toBe("[REDACTED]");
    expect(out["workerName"]).toBe("FAHADNAKASH");
  });

  it("recurses through nested objects and arrays", () => {
    const out = redactStructured({ env: [{ workerToken: "abc" }], ok: true }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('"abc"');
    expect(out["ok"]).toBe(true);
  });

  it("leaves non-string primitives untouched", () => {
    expect(redactStructured({ count: 46, open: true, missing: null })).toEqual({ count: 46, open: true, missing: null });
  });
});

describe("isSecretKeyName", () => {
  it.each(["password", "WORKER_TOKEN", "apiKey", "authorization", "sessionId", "connectionString"])(
    "treats %s as secret",
    (key) => expect(isSecretKeyName(key)).toBe(true)
  );

  it.each(["workerId", "aeStatus", "compositionCount", "path"])("treats %s as safe", (key) =>
    expect(isSecretKeyName(key)).toBe(false)
  );
});
