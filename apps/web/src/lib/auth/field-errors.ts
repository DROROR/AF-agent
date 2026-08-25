import type { ZodError, ZodIssue } from "zod";
import type { Dictionary } from "../i18n/dictionaries";

type AuthErrors = Dictionary["auth"]["errors"];

/**
 * Translates a Zod issue into a dictionary message by (field, code) rather
 * than passing the Zod-authored English `issue.message` straight through -
 * that message is always English regardless of the active locale, and
 * schema.ts's messages aren't part of the translation dictionary (they're
 * shared with the server). Field names here come from
 * @dyo/schemas' signUpRequestSchema/logInRequestSchema, not user input.
 */
function messageForIssue(issue: ZodIssue, errors: AuthErrors): string {
  const field = issue.path[0];
  if (field === "confirmPassword") {
    return errors.passwordsDoNotMatch;
  }
  if (field === "name") {
    return errors.nameRequired;
  }
  if (field === "email") {
    return errors.invalidEmail;
  }
  if (field === "password") {
    const isMinLengthIssue = issue.code === "too_small" && "minimum" in issue && issue.minimum > 1;
    return isMinLengthIssue ? errors.passwordTooShort : errors.passwordRequired;
  }
  return errors.invalidValue;
}

/** First translated error message per top-level field - shared by LoginForm and SignupForm for inline per-field validation. */
export function fieldErrorsFrom(error: ZodError, errors: AuthErrors): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in result)) {
      result[key] = messageForIssue(issue, errors);
    }
  }
  return result;
}
