"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { logInRequestSchema } from "@dyo/schemas";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { useLocale } from "../LocaleProvider";
import { fieldErrorsFrom } from "../../lib/auth/field-errors";
import { translateServerErrorCode } from "../../lib/auth/translate-server-error";

/** A hard navigation (not next/navigation's router) so middleware re-runs against the freshly-set cookie and the (dashboard) layout re-fetches the real user. */
function goToDashboard(): void {
  window.location.href = "/";
}

export function LoginForm(): ReactElement {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(null);

    const parsed = logInRequestSchema.safeParse({ email, password, rememberMe });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(parsed.error, t.auth.errors));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data)
    })
      .then(async (response) => {
        if (response.ok) {
          goToDashboard();
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        const code =
          body && typeof body === "object" && "error" in body
            ? (body as { error?: { code?: string } }).error?.code
            : undefined;
        setFormError(translateServerErrorCode(code, t.auth.errors));
        setSubmitting(false);
      })
      .catch(() => {
        setFormError(t.auth.errors.networkError);
        setSubmitting(false);
      });
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      {formError ? (
        <p className="auth-form__error" role="alert">
          {formError}
        </p>
      ) : null}

      <Field
        label={t.auth.login.emailLabel}
        htmlFor="login-email"
        {...(fieldErrors["email"] ? { error: fieldErrors["email"] } : {})}
      >
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldErrors["email"] ? true : undefined}
          disabled={submitting}
        />
      </Field>

      <Field
        label={t.auth.login.passwordLabel}
        htmlFor="login-password"
        {...(fieldErrors["password"] ? { error: fieldErrors["password"] } : {})}
      >
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={fieldErrors["password"] ? true : undefined}
          disabled={submitting}
        />
      </Field>

      <div className="auth-form__row">
        <label className="auth-form__checkbox">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            disabled={submitting}
          />
          {t.auth.login.rememberMe}
        </label>
        <span className="auth-form__pending-link" title={t.auth.login.forgotPasswordTitle}>
          {t.auth.login.forgotPassword}
        </span>
      </div>

      <Button type="submit" variant="primary" disabled={submitting} className="auth-form__submit">
        {submitting ? t.auth.login.submitting : t.auth.login.submit}
      </Button>
    </form>
  );
}
