import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { updateWorkMapRequestSchema } from "@dyo/schemas";
import type { WorkMapRepository } from "../domain/work-map/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { getWorkMap } from "../application/work-map/get-work-map.js";
import { updateWorkMap } from "../application/work-map/update-work-map.js";

export interface WorkMapRouteDeps {
  workMapRepository: WorkMapRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });

/** Real Work Map routes (asset-workmap-intake phase) - user/client INTENT, never a machine-observed source fact (see work-map.ts's own doc comment). */
export function registerWorkMapRoutes(app: FastifyInstance, deps: WorkMapRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  /** null (never 404) is a real, valid state - no work map has been saved yet. */
  app.get("/api/projects/:projectId/work-map", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const workMap = await getWorkMap({ workMapRepository: deps.workMapRepository }, projectId);
    reply.send({ workMap });
  });

  app.put("/api/projects/:projectId/work-map", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = updateWorkMapRequestSchema.parse(request.body);
    const workMap = await updateWorkMap({ workMapRepository: deps.workMapRepository, now }, projectId, body);
    reply.send({ workMap });
  });
}
