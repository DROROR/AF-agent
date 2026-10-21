import type { ReactElement } from "react";
import { JobsPage } from "@/components/JobsPage";

export const dynamic = "force-dynamic";

export default function Page(): ReactElement {
  return <JobsPage />;
}
