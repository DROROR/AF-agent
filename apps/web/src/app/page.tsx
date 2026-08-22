import type { ReactElement } from "react";
import { Dashboard } from "../components/Dashboard";

// Data is always live (worker/API/DB health) - never statically prerendered.
export const dynamic = "force-dynamic";

export default function DashboardPage(): ReactElement {
  return (
    <main>
      <h1>DYO Operations Dashboard</h1>
      <Dashboard />
    </main>
  );
}
