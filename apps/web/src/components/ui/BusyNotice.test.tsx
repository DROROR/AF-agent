// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusyNotice, formatElapsed } from "./BusyNotice";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * 2026-10-04: every slow action said it was busy in its own way - a
 * relabelled button, a sentence, or nothing - and none said for how long.
 * This is the one notice they all use now.
 */
describe("BusyNotice", () => {
  it("formats elapsed time as minutes and seconds a person reads at a glance", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9)).toBe("0:09");
    expect(formatElapsed(135)).toBe("2:15");
    expect(formatElapsed(-4)).toBe("0:00");
  });

  it("says what is happening and what happens next, as a status a screen reader announces once", () => {
    render(<BusyNotice title="Your video is being made…" description="It appears here by itself." />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Your video is being made…");
    expect(notice.textContent).toContain("It appears here by itself.");
    // No start time known: no clock is invented.
    expect(notice.querySelector(".busy-notice__elapsed")).toBeNull();
  });

  it("counts from when the thing really started - so a page reload does not reset the clock - and keeps counting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:02:15.000Z"));
    render(<BusyNotice title="Working…" startedAt="2026-10-04T10:00:00.000Z" />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    const clock = document.querySelector(".busy-notice__elapsed") as HTMLElement;
    expect(clock.textContent).toBe("2:15");
    // Not re-announced every second.
    expect(clock.getAttribute("aria-hidden")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(clock.textContent).toBe("2:20");
  });

  it("a start slightly in the future (a server clock ahead of this device) reads as zero, never negative", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
    render(<BusyNotice title="Working…" startedAt="2026-10-04T10:00:03.000Z" />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(document.querySelector(".busy-notice__elapsed")?.textContent).toBe("0:00");
  });
});
