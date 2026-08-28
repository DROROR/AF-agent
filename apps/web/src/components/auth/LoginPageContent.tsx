"use client";

import type { ReactElement } from "react";
import { LoginForm } from "./LoginForm";
import { useLocale } from "../LocaleProvider";

/**
 * Split out of app/(auth)/login/page.tsx so that file can stay a Server
 * Component and keep its static `metadata` export (Next.js does not allow
 * `metadata` in a "use client" file) while this part reads the client-only
 * locale.
 *
 * Login-only mode (see lib/feature-flags.ts): deliberately no "Sign up" /
 * "Create account" link here - Signup is temporarily disabled, so this
 * page never offers a path to it either.
 */
export function LoginPageContent(): ReactElement {
  const { t } = useLocale();

  return (
    <>
      <h1 className="auth-shell__title">{t.auth.login.title}</h1>
      <p className="auth-shell__subtitle">{t.auth.login.subtitle}</p>
      <LoginForm />
    </>
  );
}
