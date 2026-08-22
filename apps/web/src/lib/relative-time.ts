const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** "just now" / "8 seconds ago" / "2 minutes ago" - see CLAUDE.md Phase 3 task 7. Clock skew that puts `target` slightly in the future is treated as "just now" rather than showing a negative duration. */
export function formatRelativeTime(target: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - target.getTime();

  if (diffMs < 5 * SECOND_MS) {
    return "just now";
  }
  if (diffMs < MINUTE_MS) {
    return plural(Math.floor(diffMs / SECOND_MS), "second");
  }
  if (diffMs < HOUR_MS) {
    return plural(Math.floor(diffMs / MINUTE_MS), "minute");
  }
  if (diffMs < DAY_MS) {
    return plural(Math.floor(diffMs / HOUR_MS), "hour");
  }
  return plural(Math.floor(diffMs / DAY_MS), "day");
}
