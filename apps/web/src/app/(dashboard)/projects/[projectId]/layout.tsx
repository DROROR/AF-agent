import type { ReactElement, ReactNode } from "react";
import { ProjectGuidanceProvider } from "@/components/ProjectGuidanceProvider";
import { ProjectWorkspaceProvider } from "@/components/ProjectWorkspaceProvider";
import { ProjectWorkspaceShell } from "@/components/ProjectWorkspaceShell";
import { WorkspaceModeProvider } from "@/components/WorkspaceModeProvider";

export default async function ProjectWorkspaceLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}): Promise<ReactElement> {
  const { projectId } = await params;
  return (
    <WorkspaceModeProvider>
      <ProjectWorkspaceProvider projectId={projectId}>
        {/*
          ProjectGuidanceProvider sits INSIDE the workspace provider (it reads
          project+plan from it) and OUTSIDE the shell, so the stepper, the
          "what to do next" banner and the tab nav's locked/next markers all
          read one identical derivation - see its own doc comment and the
          2026-09-25 incident behind it.
        */}
        <ProjectGuidanceProvider projectId={projectId}>
          <ProjectWorkspaceShell projectId={projectId}>{children}</ProjectWorkspaceShell>
        </ProjectGuidanceProvider>
      </ProjectWorkspaceProvider>
    </WorkspaceModeProvider>
  );
}
