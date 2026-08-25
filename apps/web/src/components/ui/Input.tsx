import type { InputHTMLAttributes, ReactElement } from "react";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input className={["input", className].filter(Boolean).join(" ")} {...rest} />;
}
