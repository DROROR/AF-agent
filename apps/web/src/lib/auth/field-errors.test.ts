import { describe, expect, it } from "vitest";
import { logInRequestSchema, signUpRequestSchema } from "@dyo/schemas";
import { en } from "../i18n/dictionaries/en";
import { fieldErrorsFrom } from "./field-errors";

describe("fieldErrorsFrom", () => {
  it("keys the first translated error message per top-level field", () => {
    const result = logInRequestSchema.safeParse({ email: "not-an-email", password: "" });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const errors = fieldErrorsFrom(result.error, en.auth.errors);
    expect(errors["email"]).toBe(en.auth.errors.invalidEmail);
    expect(errors["password"]).toBe(en.auth.errors.passwordRequired);
  });

  it("distinguishes a too-short signup password from a missing login password", () => {
    const result = signUpRequestSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "short",
      confirmPassword: "short"
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const errors = fieldErrorsFrom(result.error, en.auth.errors);
    expect(errors["password"]).toBe(en.auth.errors.passwordTooShort);
  });

  it("maps a confirmPassword mismatch to the dedicated message", () => {
    const result = signUpRequestSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "different"
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const errors = fieldErrorsFrom(result.error, en.auth.errors);
    expect(errors["confirmPassword"]).toBe(en.auth.errors.passwordsDoNotMatch);
  });

  it("returns an empty object for no issues", () => {
    const result = logInRequestSchema.safeParse({ email: "ada@example.com", password: "x" });
    expect(result.success).toBe(true);
  });
});
