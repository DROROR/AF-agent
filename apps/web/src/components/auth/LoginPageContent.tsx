"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { LoginForm } from "./LoginForm";
import { useLocale } from "../LocaleProvider";

/**
 * Split out of app/(auth)/login/page.tsx so that file can stay a Server
 * Component and keep its static `metadata` export (Next.js does not allow
 * `metadata` in a "use client" file) while this part reads the client-only
 * locale.
 */
export function LoginPageContent(): ReactElement {
  const { t } = useLocale();

  return (
    <>
      <h1 className="auth-shell__title">{t.auth.login.title}</h1>
      <p className="auth-shell__subtitle">{t.auth.login.subtitle}</p>
      <LoginForm />
      <p className="auth-shell__switch">
        {t.auth.login.noAccount} <Link href="/signup">{t.auth.login.createOne}</Link>
      </p>
    </>
  );
}
