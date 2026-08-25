import type { ReactElement } from "react";
import { SignupPageContent } from "@/components/auth/SignupPageContent";

export const metadata = { title: "Create account - DYO Dashboard" };

export default function SignupPage(): ReactElement {
  return <SignupPageContent />;
}
