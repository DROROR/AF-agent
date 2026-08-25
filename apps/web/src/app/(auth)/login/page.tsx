import type { ReactElement } from "react";
import { LoginPageContent } from "@/components/auth/LoginPageContent";

export const metadata = { title: "Sign in - DYO Dashboard" };

export default function LoginPage(): ReactElement {
  return <LoginPageContent />;
}
