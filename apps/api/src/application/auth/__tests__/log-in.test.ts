import { describe, expect, it } from "vitest";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "../../../infrastructure/auth/password.js";
import { generateSessionToken, hashSessionSecret } from "../../../infrastructure/auth/session-token.js";
import { InvalidCredentialsError } from "../../../errors/app-error.js";
import { InMemorySessionRepository } from "../test-support/in-memory-session-repository.js";
import { InMemoryUserRepository } from "../test-support/in-memory-user-repository.js";
import { signUp } from "../sign-up.js";
import { logIn } from "../log-in.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

async function seededDeps() {
  const userRepository = new InMemoryUserRepository();
  const sessionRepository = new InMemorySessionRepository();
  const shared = {
    userRepository,
    sessionRepository,
    hashPassword,
    verifyPassword,
    getDummyPasswordHash,
    generateSessionToken,
    hashSessionSecret,
    sessionTtlMs: 60_000,
    now: () => FIXED_NOW
  };
  await signUp(shared, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse",
    confirmPassword: "correct-horse"
  });
  return shared;
}

describe("logIn", () => {
  it("succeeds with the correct email and password, updates lastLoginAt, and returns a session", async () => {
    const deps = await seededDeps();

    const result = await logIn(deps, { email: "ada@example.com", password: "correct-horse", rememberMe: false });

    expect(result.user.email).toBe("ada@example.com");
    expect(result.user.lastLoginAt?.getTime()).toBe(FIXED_NOW.getTime());
    expect(result.cookieValue).toContain(".");
  });

  it("grants a longer session TTL when rememberMe is true", async () => {
    const deps = await seededDeps();

    const result = await logIn(deps, { email: "ada@example.com", password: "correct-horse", rememberMe: true });

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBe(FIXED_NOW.getTime() + thirtyDaysMs);
  });

  it("rejects the wrong password with a generic error", async () => {
    const deps = await seededDeps();

    await expect(
      logIn(deps, { email: "ada@example.com", password: "wrong-password", rememberMe: false })
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects an email that was never registered with the same generic error (no user enumeration)", async () => {
    const deps = await seededDeps();

    await expect(
      logIn(deps, { email: "nobody@example.com", password: "whatever123", rememberMe: false })
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
