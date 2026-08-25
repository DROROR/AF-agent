import type { Dictionary } from "../i18n/dictionaries";

type AuthErrors = Dictionary["auth"]["errors"];

/**
 * Maps the API's typed error `code` (never its English `message`, which is
 * not locale-aware) to a translated message. Used for both login and
 * signup failures.
 */
export function translateServerErrorCode(code: string | undefined, errors: AuthErrors): string {
  switch (code) {
    case "UNAUTHORIZED":
      return errors.invalidCredentials;
    case "CONFLICT":
      return errors.emailAlreadyExists;
    case "RATE_LIMITED":
      return errors.tooManyAttempts;
    case "VALIDATION_ERROR":
      return errors.invalidValue;
    default:
      return errors.somethingWentWrong;
  }
}
