import type { Locale } from "./i18n/locale";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "just now" / "8 seconds ago" / "2 minutes ago" - see CLAUDE.md Phase 3
 * task 7. Clock skew that puts `target` slightly in the future is treated
 * as "just now" rather than showing a negative duration.
 *
 * Uses the built-in Intl.RelativeTimeFormat (no new dependency) so Hebrew
 * gets grammatically correct output (its plural/singular rules differ from
 * English) rather than a hand-rolled "N unit(s) ago" template blindly
 * reused across locales - verified to produce byte-identical English
 * output to the original hand-rolled implementation.
 */
export function formatRelativeTime(target: Date, now: Date = new Date(), locale: Locale = "en"): string {
  const diffMs = now.getTime() - target.getTime();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });

  if (diffMs < 5 * SECOND_MS) {
    return locale === "he" ? "הרגע" : "just now";
  }
  if (diffMs < MINUTE_MS) {
    return rtf.format(-Math.floor(diffMs / SECOND_MS), "second");
  }
  if (diffMs < HOUR_MS) {
    return rtf.format(-Math.floor(diffMs / MINUTE_MS), "minute");
  }
  if (diffMs < DAY_MS) {
    return rtf.format(-Math.floor(diffMs / HOUR_MS), "hour");
  }
  return rtf.format(-Math.floor(diffMs / DAY_MS), "day");
}
