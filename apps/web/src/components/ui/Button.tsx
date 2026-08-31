import type { ButtonHTMLAttributes, ReactElement } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps): ReactElement {
  const classes = ["btn", `btn--${variant}`, size === "sm" ? "btn--sm" : null, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
