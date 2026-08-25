import { describe, expect, it } from "vitest";
import { hashPassword } from "../../../infrastructure/auth/password.js";
import { generateSessionToken, hashSessionSecret, verifySessionSecret } from "../../../infrastructure/auth/session-token.js";
import { InMemorySessionRepository } from "../test-support/in-memory-session-repository.js";
import { InMemoryUserRepository } from "../test-support/in-memory-user-repository.js";
import { signUp } from "../sign-up.js";
import { logOut } from "../log-out.js";
import { validateSession } from "../validate-session.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

async function seeded(now: () => Date = () => FIXED_NOW) {
  const userRepository = new InMemoryUserRepository();
  const sessionRepository = new InMemorySessionRepository();
  const session = await signUp(
    {
      userRepository,
      sessionRepository,
      hashPassword,
      generateSessionToken,
      hashSessionSecret,
      sessionTtlMs: 60_000,
      now
    },
    { name: "Ada", email: "ada@example.com", password: "correct-horse", confirmPassword: "correct-horse" }
  );
  return { userRepository, sessionRepository, session };
}

describe("validateSession", () => {
  it("resolves the user for a valid, unexpired session cookie", async () => {
    const { userRepository, sessionRepository, session } = await seeded();

    const user = await validateSession(
      { sessionRepository, userRepository, verifySessionSecret, now: () => FIXED_NOW },
      session.cookieValue
    );

    expect(user?.email).toBe("ada@example.com");
  });

  it("returns null for a malformed cookie value", async () => {
    const { userRepository, sessionRepository } = await seeded();

    const user = await validateSession(
      { sessionRepository, userRepository, verifySessionSecret, now: () => FIXED_NOW },
      "not-a-real-token"
    );

    expect(user).toBeNull();
  });

  it("returns null once the session has expired, and removes it", async () => {
    let current = FIXED_NOW;
    const { userRepository, sessionRepository, session } = await seeded(() => current);
    current = new Date(FIXED_NOW.getTime() + 61_000);

    const user = await validateSession(
      { sessionRepository, userRepository, verifySessionSecret, now: () => current },
      session.cookieValue
    );

    expect(user).toBeNull();
    const sessionId = session.cookieValue.split(".")[0] ?? "";
    await expect(sessionRepository.findById(sessionId)).resolves.toBeNull();
  });

  it("returns null after logout invalidates the session", async () => {
    const { userRepository, sessionRepository, session } = await seeded();
    const sessionId = session.cookieValue.split(".")[0] ?? "";

    await logOut({ sessionRepository }, sessionId);

    const user = await validateSession(
      { sessionRepository, userRepository, verifySessionSecret, now: () => FIXED_NOW },
      session.cookieValue
    );
    expect(user).toBeNull();
  });

  it("returns null when the secret half of the cookie doesn't match the stored hash", async () => {
    const { userRepository, sessionRepository, session } = await seeded();
    const sessionId = session.cookieValue.split(".")[0] ?? "";
    const tamperedCookie = `${sessionId}.wrong-secret-value`;

    const user = await validateSession(
      { sessionRepository, userRepository, verifySessionSecret, now: () => FIXED_NOW },
      tamperedCookie
    );
    expect(user).toBeNull();
  });
});
