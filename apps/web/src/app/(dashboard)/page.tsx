import { redirect } from "next/navigation";

/**
 * 2026-10-21 simplification: the dashboard opens on the projects list. The
 * former Overview (API/database/worker health) duplicated the top bar's own
 * "All systems normal" and the project pages' own worker notices.
 */
export default function Page(): never {
  redirect("/projects");
}
