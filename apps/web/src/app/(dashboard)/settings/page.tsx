import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { SettingsPage } from "@/components/SettingsPage";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export const dynamic = "force-dynamic";

export default async function Page(): Promise<ReactElement> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return <SettingsPage user={user} />;
}
