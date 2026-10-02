"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { useLocale } from "../LocaleProvider";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** "drawer" slides in from the end edge (right in LTR, left in RTL - see globals.css's `.overlay { justify-content: flex-end }`, which is direction-aware by itself); "modal" is centered (confirmations, short forms). */
  variant?: "drawer" | "modal";
}

/**
 * Minimal accessible dialog: traps focus, restores it to the trigger on
 * close, closes on Escape and backdrop click. No animation library and no
 * portal dependency - a fixed-position overlay is sufficient here and
 * keeps this free of new runtime dependencies.
 */
export function Dialog({ open, onClose, title, children, variant = "modal" }: DialogProps): ReactElement | null {
  const { t } = useLocale();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // The latest onClose, without making it a reason to re-run the focus
  // effect below. REAL 2026-10-02 DEFECT: a caller passing a new function on
  // every render (the scene edit drawer does) re-ran that effect on every
  // keystroke - it moved focus to the dialog itself each time, so a person
  // typing had to click back into the box after every single letter.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) {
        return;
      }
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }
      // Guaranteed defined: the length check above already ensures at
      // least one element exists.
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={variant === "drawer" ? "overlay" : "overlay overlay--centered"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        className={variant === "drawer" ? "drawer" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog__header">
          <span id={titleId} className="dialog__title">
            {title}
          </span>
          <button type="button" className="dialog__close" onClick={onClose} aria-label={t.common.close}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}
