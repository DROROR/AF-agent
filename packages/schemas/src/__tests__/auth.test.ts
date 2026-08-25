import { describe, expect, it } from "vitest";
import { logInRequestSchema, signUpRequestSchema, userDtoSchema } from "../auth.js";

describe("signUpRequestSchema", () => {
  it("accepts a valid signup payload", () => {
    const result = signUpRequestSchema.parse({
      name: "Ada Lovelace",
      email: "Ada@Example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse"
    });
    expect(result.email).toBe("ada@example.com");
  });

  it("rejects mismatched passwords", () => {
    expect(() =>
      signUpRequestSchema.parse({
        name: "Ada",
        email: "ada@example.com",
        password: "correct-horse",
        confirmPassword: "different"
      })
    ).toThrow();
  });

  it("rejects a password under 8 characters", () => {
    expect(() =>
      signUpRequestSchema.parse({
        name: "Ada",
        email: "ada@example.com",
        password: "short1",
        confirmPassword: "short1"
      })
    ).toThrow();
  });

  it("rejects a blank name", () => {
    expect(() =>
      signUpRequestSchema.parse({
        name: "",
        email: "ada@example.com",
        password: "correct-horse",
        confirmPassword: "correct-horse"
      })
    ).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() =>
      signUpRequestSchema.parse({
        name: "Ada",
        email: "not-an-email",
        password: "correct-horse",
        confirmPassword: "correct-horse"
      })
    ).toThrow();
  });
});

describe("logInRequestSchema", () => {
  it("normalizes email and defaults rememberMe to false", () => {
    const result = logInRequestSchema.parse({ email: "Ada@Example.com", password: "anything" });
    expect(result).toEqual({ email: "ada@example.com", password: "anything", rememberMe: false });
  });

  it("rejects an empty password", () => {
    expect(() => logInRequestSchema.parse({ email: "ada@example.com", password: "" })).toThrow();
  });
});

describe("userDtoSchema", () => {
  it("never accepts a passwordHash field as part of its own shape (documents the contract, not just convention)", () => {
    const shape = userDtoSchema.shape as Record<string, unknown>;
    expect(shape["passwordHash"]).toBeUndefined();
    expect(shape["password"]).toBeUndefined();
  });
});
