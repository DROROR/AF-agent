import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

const now = new Date("2026-01-01T00:00:00.000Z");

function secondsAgo(seconds: number): Date {
  return new Date(now.getTime() - seconds * 1000);
}

describe("formatRelativeTime", () => {
  it('returns "just now" for anything under 5 seconds', () => {
    expect(formatRelativeTime(secondsAgo(0), now)).toBe("just now");
    expect(formatRelativeTime(secondsAgo(4), now)).toBe("just now");
  });

  it("reports whole seconds between 5s and 1 minute", () => {
    expect(formatRelativeTime(secondsAgo(8), now)).toBe("8 seconds ago");
    expect(formatRelativeTime(secondsAgo(59), now)).toBe("59 seconds ago");
  });

  it("reports minutes between 1 minute and 1 hour", () => {
    expect(formatRelativeTime(secondsAgo(120), now)).toBe("2 minutes ago");
    expect(formatRelativeTime(secondsAgo(60), now)).toBe("1 minute ago");
  });

  it("reports hours between 1 hour and 1 day", () => {
    expect(formatRelativeTime(secondsAgo(3 * 3600), now)).toBe("3 hours ago");
    expect(formatRelativeTime(secondsAgo(3600), now)).toBe("1 hour ago");
  });

  it("reports days beyond 1 day", () => {
    expect(formatRelativeTime(secondsAgo(2 * 86400), now)).toBe("2 days ago");
    expect(formatRelativeTime(secondsAgo(86400), now)).toBe("1 day ago");
  });

  it('treats a target slightly in the future as "just now" (clock skew)', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 2000), now)).toBe("just now");
  });
});
