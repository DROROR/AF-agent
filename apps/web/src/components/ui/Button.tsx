"use client";

import { useId, type ButtonHTMLAttributes, type ReactElement } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Why this button is currently unavailable, and what would make it
   * available - shown next to the button, and wired to it with
   * aria-describedby so a screen reader announces it with the control.
   *
   * REAL 2026-09-25 INCIDENT: the operator who runs this dashboard daily
   * repeatedly got stuck on buttons that were greyed out with no
   * explanation, and had to ask what was wrong every time. A disabled
   * control with no stated reason was named the single worst thing in this
   * UI, so this is the shared mechanism for fixing it rather than each call
   * site inventing its own stray <p> that may or may not sit near the
   * control it explains.
   *
   * Deliberately opt-in and inert when the button is enabled: passing a
   * reason costs nothing on an enabled button (no wrapper, no markup
   * change), so a call site can compute one unconditionally. `title` is set
   * as well, for the hover affordance people already expect.
   */
  disabledReason?: string | undefined;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", disabledReason, ...rest }: ButtonProps): ReactElement {
  const reasonId = useId();
  const showReason = Boolean(rest.disabled) && typeof disabledReason === "string" && disabledReason.length > 0;
  const classes = ["btn", `btn--${variant}`, size === "sm" ? "btn--sm" : null, className].filter(Boolean).join(" ");

  // The wrapper is ALWAYS rendered, and is `display: contents` until it has
  // something to say - so the <button> keeps the exact same position in its
  // parent's flex/grid layout whether or not a reason is showing, and (the
  // reason this is unconditional) React never unmounts and remounts the
  // button when it flips between disabled and enabled. An earlier version
  // added the wrapper only while disabled, which silently replaced the DOM
  // node the moment a button became usable: anything holding a reference to
  // it - keyboard focus, and a real test in ProjectExportTab.test.tsx - was
  // left pointing at a detached, permanently-disabled element.
  return (
    <span className="btn-with-reason" data-has-reason={showReason ? "true" : undefined}>
      <button
        type={type}
        className={classes}
        {...(showReason ? { "aria-describedby": reasonId, title: disabledReason } : {})}
        {...rest}
      />
      {showReason ? (
        <span id={reasonId} className="btn-disabled-reason" role="note">
          {disabledReason}
        </span>
      ) : null}
    </span>
  );
}
