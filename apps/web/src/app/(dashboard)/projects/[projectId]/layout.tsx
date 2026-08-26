import type { ReactElement, ReactNode } from "react";
import { ProjectWorkspaceProvider } from "@/components/ProjectWorkspaceProvider";
import { ProjectWorkspaceShell } from "@/components/ProjectWorkspaceShell";

export default async function ProjectWorkspaceLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}): Promise<ReactElement> {
  const { projectId } = await params;
  return (
    <ProjectWorkspaceProvider projectId={projectId}>
      <ProjectWorkspaceShell projectId={projectId}>{children}</ProjectWorkspaceShell>
    </ProjectWorkspaceProvider>
  );
}
