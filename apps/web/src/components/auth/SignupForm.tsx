"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { signUpRequestSchema } from "@dyo/schemas";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { useLocale } from "../LocaleProvider";
import { fieldErrorsFrom } from "../../lib/auth/field-errors";
import { translateServerErrorCode } from "../../lib/auth/translate-server-error";

function goToDashboard(): void {
  window.location.href = "/";
}

export function SignupForm(): ReactElement {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(null);

    const parsed = signUpRequestSchema.safeParse({ name, email, password, confirmPassword });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(parsed.error, t.auth.errors));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    fetch("/api/auth/signup", {
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
        label={t.auth.signup.nameLabel}
        htmlFor="signup-name"
        {...(fieldErrors["name"] ? { error: fieldErrors["name"] } : {})}
      >
        <Input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={fieldErrors["name"] ? true : undefined}
          disabled={submitting}
        />
      </Field>

      <Field
        label={t.auth.signup.emailLabel}
        htmlFor="signup-email"
        {...(fieldErrors["email"] ? { error: fieldErrors["email"] } : {})}
      >
        <Input
          id="signup-email"
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
        label={t.auth.signup.passwordLabel}
        htmlFor="signup-password"
        hint={t.auth.signup.passwordHint}
        {...(fieldErrors["password"] ? { error: fieldErrors["password"] } : {})}
      >
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={fieldErrors["password"] ? true : undefined}
          disabled={submitting}
        />
      </Field>

      <Field
        label={t.auth.signup.confirmPasswordLabel}
        htmlFor="signup-confirm-password"
        {...(fieldErrors["confirmPassword"] ? { error: fieldErrors["confirmPassword"] } : {})}
      >
        <Input
          id="signup-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={fieldErrors["confirmPassword"] ? true : undefined}
          disabled={submitting}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={submitting} className="auth-form__submit">
        {submitting ? t.auth.signup.submitting : t.auth.signup.submit}
      </Button>
    </form>
  );
}
