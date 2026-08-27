import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RenderArtifactRepository } from "../domain/render-artifact/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { listRenderArtifacts } from "../application/render-artifact/list-render-artifacts.js";
import { getRenderArtifactFile } from "../application/render-artifact/get-render-artifact-file.js";

export interface RenderArtifactsRouteDeps {
  renderArtifactRepository: RenderArtifactRepository;
  assetStorage: AssetStorage;
  projectRepository: ProjectRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });
const artifactParamsSchema = z.object({ projectId: z.string().uuid(), artifactId: z.string().uuid() });

/**
 * Render-result metadata AND authenticated download for the dashboard
 * (render-engine phase section 12, render-delivery phase section 6) -
 * authenticated dashboard session required for both, same pattern as
 * routes/assets.ts. Only a genuinely persisted render_artifacts row (only
 * ever created for a validated, real-bytes-uploaded RENDER result - see
 * record-render-artifact.ts) is ever downloadable; a failed/partial render
 * never has a row here at all, so it can never become downloadable.
 */
export function registerRenderArtifactRoutes(app: FastifyInstance, deps: RenderArtifactsRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.get("/api/projects/:projectId/render-artifacts", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const artifacts = await listRenderArtifacts(
      { renderArtifactRepository: deps.renderArtifactRepository, projectRepository: deps.projectRepository },
      projectId
    );
    reply.send({ artifacts });
  });

  /**
   * Streams the real bytes back - never exposes a storage key or
   * filesystem path in the response (section 6). `artifactParamsSchema`
   * requires BOTH projectId and artifactId to match a real persisted row
   * (findByIdForProject) - a cross-project artifactId guess is refused
   * identically to one that doesn't exist at all.
   */
  app.get("/api/projects/:projectId/render-artifacts/:artifactId/file", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, artifactId } = artifactParamsSchema.parse(request.params);
    const file = await getRenderArtifactFile(
      { renderArtifactRepository: deps.renderArtifactRepository, assetStorage: deps.assetStorage },
      projectId,
      artifactId
    );
    reply.header("content-type", file.mimeType);
    // filename is always this worker's own fixed, deterministic basename
    // (see render-output-path.ts's own OUTPUT_FILENAME constant) - never a
    // caller-supplied string, so no header-injection risk from it.
    reply.header("content-disposition", `attachment; filename="${file.filename}"`);
    reply.send(file.buffer);
  });
}
