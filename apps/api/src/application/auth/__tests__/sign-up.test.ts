import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../infrastructure/auth/password.js";
import { generateSessionToken, hashSessionSecret } from "../../../infrastructure/auth/session-token.js";
import { EmailAlreadyRegisteredError } from "../../../errors/app-error.js";
import { InMemorySessionRepository } from "../test-support/in-memory-session-repository.js";
import { InMemoryUserRepository } from "../test-support/in-memory-user-repository.js";
import { signUp } from "../sign-up.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function deps() {
  return {
    userRepository: new InMemoryUserRepository(),
    sessionRepository: new InMemorySessionRepository(),
    hashPassword,
    generateSessionToken,
    hashSessionSecret,
    sessionTtlMs: 60_000,
    now: () => FIXED_NOW
  };
}

describe("signUp", () => {
  it("creates a user with a hashed (never plaintext) password and an active session", async () => {
    const testDeps = deps();

    const result = await signUp(testDeps, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse"
    });

    expect(result.user.email).toBe("ada@example.com");
    expect(result.user.passwordHash).not.toContain("correct-horse");
    await expect(verifyPassword("correct-horse", result.user.passwordHash)).resolves.toBe(true);
    expect(result.cookieValue).toContain(".");
    expect(result.expiresAt.getTime()).toBe(FIXED_NOW.getTime() + 60_000);
  });

  it("rejects a second signup with an already-registered email", async () => {
    const testDeps = deps();
    await signUp(testDeps, {
      name: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse"
    });

    await expect(
      signUp(testDeps, {
        name: "Someone Else",
        email: "ada@example.com",
        password: "another-password",
        confirmPassword: "another-password"
      })
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it("defaults a new account to the OPERATOR role", async () => {
    const testDeps = deps();
    const result = await signUp(testDeps, {
      name: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse"
    });
    expect(result.user.role).toBe("OPERATOR");
  });
});
