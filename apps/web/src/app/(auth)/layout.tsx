import type { ReactElement, ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageToggle } from "@/components/LanguageToggle";

/** No sidebar/topbar - a minimal, centered shell shared by /login and /signup. */
export default function AuthLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="auth-shell">
      <div className="auth-shell__language">
        <LanguageToggle />
      </div>
      <div className="auth-shell__card">
        <div className="auth-shell__brand">
          <div className="auth-shell__brand-circle">
            <BrandLogo variant="full" height={64} priority />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
