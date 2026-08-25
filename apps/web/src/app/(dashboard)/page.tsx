import type { ReactElement } from "react";
import { OverviewPage } from "@/components/OverviewPage";

// Data is always live (worker/API/DB health) - never statically prerendered.
export const dynamic = "force-dynamic";

export default function Page(): ReactElement {
  return <OverviewPage />;
}
