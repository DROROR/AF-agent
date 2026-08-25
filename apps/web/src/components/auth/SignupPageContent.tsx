"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { SignupForm } from "./SignupForm";
import { useLocale } from "../LocaleProvider";

/** See LoginPageContent.tsx's comment - same split, for the same reason. */
export function SignupPageContent(): ReactElement {
  const { t } = useLocale();

  return (
    <>
      <h1 className="auth-shell__title">{t.auth.signup.title}</h1>
      <p className="auth-shell__subtitle">{t.auth.signup.subtitle}</p>
      <SignupForm />
      <p className="auth-shell__switch">
        {t.auth.signup.haveAccount} <Link href="/login">{t.auth.signup.signIn}</Link>
      </p>
    </>
  );
}
