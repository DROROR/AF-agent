import type { ReactElement } from "react";
import { WorkersPage } from "@/components/WorkersPage";

export const dynamic = "force-dynamic";

export default function Page(): ReactElement {
  return <WorkersPage />;
}
