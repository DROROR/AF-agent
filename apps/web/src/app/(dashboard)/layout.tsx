import { redirect } from "next/navigation";
import type { ReactElement, ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { DashboardStatusProvider } from "@/components/DashboardStatusProvider";
import { getCurrentUser } from "@/lib/auth/get-current-user";

/**
 * Wraps every real dashboard page (not /login or /signup - see the
 * sibling (auth) route group). middleware.ts already redirects an
 * unauthenticated request before it gets this far; this is defense in
 * depth for the rare race (session expires between the middleware check
 * and this render) rather than the primary guard.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardStatusProvider>
      <AppShell user={user}>{children}</AppShell>
    </DashboardStatusProvider>
  );
}
