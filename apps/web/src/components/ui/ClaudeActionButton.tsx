import type { ButtonHTMLAttributes, ReactElement } from "react";

/**
 * Abstract 8-point sunburst mark, in Claude/Anthropic's own brand color -
 * a local, static, inline SVG (never a hotlinked third-party image URL -
 * see this component's own module doc comment). Not the literal Anthropic
 * wordmark/logotype (no license to redistribute that asset file exists in
 * this repo) - a good-faith visual reference to Claude's own public mark
 * shape, used consistently only on this one button.
 */
function ClaudeMark(): ReactElement {
  return (
    <svg className="btn--claude__mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0l1.8 8.2L22 10l-8.2 1.8L12 20l-1.8-8.2L2 10l8.2-1.8z" />
    </svg>
  );
}

export interface ClaudeActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> {
  /** The action label WITHOUT the "Claude — " prefix - this component always adds it, so every real Claude action reads consistently (e.g. "Claude — Create Video Plan"). */
  label: string;
  /** Shown instead of `label` while the real Anthropic call is in flight (e.g. "Thinking…") - never a raw "Loading". */
  busyLabel?: string;
  busy?: boolean;
  size?: "md" | "sm";
}

/**
 * The ONE reusable button for an action that genuinely calls the
 * configured Anthropic API - never used for a deterministic action
 * (Upload/Save/Approve/Delete/Render/Download - see CLAUDE.md "Runtime AI
 * is optional... never make it mandatory for the core workflow" and this
 * task's own explicit branding rule). A caller must never render this
 * unless the real provider capability it is wired to is actually
 * ANTHROPIC-backed - see each call site's own doc comment for why that
 * check is safe today (DB_AI_PROVIDER_NAMES is a single-value enum,
 * `["ANTHROPIC"]` - packages/database/src/schema.ts).
 */
export function ClaudeActionButton({ label, busyLabel, busy, size = "md", className, disabled, ...rest }: ClaudeActionButtonProps): ReactElement {
  const classes = ["btn", "btn--claude", size === "sm" ? "btn--sm" : null, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} disabled={disabled || busy} {...rest}>
      <ClaudeMark />
      <span>{`Claude — ${busy && busyLabel ? busyLabel : label}`}</span>
    </button>
  );
}
