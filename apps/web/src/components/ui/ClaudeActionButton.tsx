import type { ButtonHTMLAttributes, ReactElement } from "react";

/**
 * The real Anthropic "A" mark - a local, static, inline SVG (never a
 * hotlinked third-party image URL at runtime - see this component's own
 * module doc comment). Path data taken from the Simple Icons project
 * (simple-icons.org, MIT-licensed for exactly this "monochrome brand mark,
 * recolored via currentColor" use), which mirrors Anthropic's own public
 * mark - never fetched live from this component; the path is checked into
 * this file so the icon renders identically with no network dependency
 * and no CSP/hotlink risk.
 */
function ClaudeMark(): ReactElement {
  return (
    <svg className="btn--claude__mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
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
