import type { ReactElement } from "react";
import { ProjectChecklist } from "@/components/ProjectChecklist";
import { ProjectOverviewTab } from "@/components/ProjectOverviewTab";

/**
 * The project's front page. ProjectChecklist is the page now - every step it
 * takes to get a finished video, in order, with the one you are on opened up
 * and the button inside it. ProjectOverviewTab follows as a closed drawer of
 * plan facts and the Advanced approve/reject/reopen controls, which are real
 * and kept, but which nobody making a video has to read first.
 *
 * Both read the same already-loaded project/plan/guidance context from this
 * route's layout - neither adds a fetch.
 */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }): Promise<ReactElement> {
  const { projectId } = await params;
  return (
    <>
      <ProjectChecklist projectId={projectId} />
      <ProjectOverviewTab />
    </>
  );
}
