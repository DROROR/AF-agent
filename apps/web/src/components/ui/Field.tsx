import type { ReactElement, ReactNode } from "react";

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  /** Validation error text - rendered instead of hint, with role="alert" so a screen reader announces it as it appears. */
  error?: string;
  children: ReactNode;
}

/** Consistent label + control + hint/error wrapper, used by both the New-Project-flow forms and the auth (login/signup) forms. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps): ReactElement {
  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}
