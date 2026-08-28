import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { SignupPageContent } from "@/components/auth/SignupPageContent";
import { SIGNUP_ENABLED } from "@/lib/feature-flags";

export const metadata = { title: "Create account - DYO Dashboard" };

/** Login-only mode (see lib/feature-flags.ts) - direct access redirects safely to /login rather than 404ing or rendering a dead form. */
export default function SignupPage(): ReactElement {
  if (!SIGNUP_ENABLED) {
    redirect("/login");
  }
  return <SignupPageContent />;
}
