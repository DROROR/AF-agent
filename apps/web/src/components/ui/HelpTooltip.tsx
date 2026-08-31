"use client";

import { useId, useState, type ReactElement } from "react";
import { HelpCircle } from "lucide-react";

export interface HelpTooltipProps {
  text: string;
  /** Screen-reader label for the trigger itself (e.g. "Help: Timestamp"). Falls back to `text`. */
  label?: string;
}

/**
 * Field-level self-service help (client-handoff phase, section 6) - a small
 * "?" affordance next to a label that reveals one or two plain-language
 * sentences on hover/focus/click. Never engineering language: copy comes
 * from the caller via i18n, this component only handles disclosure.
 */
export function HelpTooltip({ text, label }: HelpTooltipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const bubbleId = useId();

  return (
    <span className="help-tooltip">
      <button
        type="button"
        className="help-tooltip__trigger"
        aria-describedby={bubbleId}
        aria-label={label ?? text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        <HelpCircle aria-hidden="true" size={14} />
      </button>
      <span role="tooltip" id={bubbleId} className="help-tooltip__bubble" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
