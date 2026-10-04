"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";

/** "2:15" - minutes and seconds only; nothing here runs long enough to need hours, and a client reads this at a glance. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The wall clock, for an event handler to note when the thing it just
 * started began - what the clock below then counts from. Never called while
 * rendering.
 */
export function currentTimeMs(): number {
  return Date.now();
}

/**
 * Whole seconds since `startedAt`, ticking once a second. `startedAt` is
 * whatever the caller really knows: an ISO time from the server (a job's own
 * createdAt, so the clock is still right after a page reload) or a
 * Date.now() taken when the action began. A start in the future (a server
 * clock slightly ahead of this device) reads as zero, never as negative.
 */
export function useElapsedSeconds(startedAt: string | number | null | undefined): number | null {
  const startMs = startedAt === null || startedAt === undefined ? null : typeof startedAt === "number" ? startedAt : new Date(startedAt).getTime();
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (startMs === null || Number.isNaN(startMs)) {
      return;
    }
    const tick = (): void => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [startMs]);

  if (startMs === null || Number.isNaN(startMs)) {
    return null;
  }
  return nowMs === null ? 0 : Math.max(0, Math.floor((nowMs - startMs) / 1_000));
}

export interface BusyNoticeProps {
  /** What is happening, in the client's words - "Your video is being made…". */
  title: string;
  /** What will happen when it finishes, and whether they have to stay. */
  description?: string;
  /** When it really started; omit when that is not known and no clock is shown. */
  startedAt?: string | number | null;
  /** Smaller, single-line form for inside a card or beside a button. */
  compact?: boolean;
}

/**
 * The one "this is running" notice (2026-10-04).
 *
 * Seen live that day: "Create Complete Preview" was pressed, nothing on the
 * page changed for minutes, it was pressed again, and the answer was a red
 * line of server text. Every slow action had its own way of saying it was
 * busy - a relabelled button, a sentence, or nothing - and none said for how
 * long. This says the three things a person waiting needs: that it started,
 * what is happening, and how long it has been going; `description` carries
 * what happens when it ends.
 *
 * role="status" so a screen reader announces it once; the ticking clock is
 * aria-hidden so it is not re-announced every second.
 */
export function BusyNotice({ title, description, startedAt, compact = false }: BusyNoticeProps): ReactElement {
  const elapsed = useElapsedSeconds(startedAt);
  return (
    <div className={compact ? "busy-notice busy-notice--compact" : "busy-notice"} role="status">
      <Loader2 className="busy-notice__spinner" size={compact ? 16 : 20} aria-hidden="true" />
      <div className="busy-notice__body">
        <p className="busy-notice__title">
          {title}
          {elapsed === null ? null : (
            <span className="busy-notice__elapsed" aria-hidden="true">
              {formatElapsed(elapsed)}
            </span>
          )}
        </p>
        {description ? <p className="busy-notice__description">{description}</p> : null}
      </div>
    </div>
  );
}
