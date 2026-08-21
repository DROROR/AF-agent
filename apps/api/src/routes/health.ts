import type { FastifyInstance } from "fastify";

export interface HealthDeps {
  checkDatabaseHealth: () => Promise<boolean>;
}

/**
 * Liveness never depends on external services (process is up or it isn't).
 * Readiness reflects real dependency health - it must not report green when
 * PostgreSQL is unreachable (docs/engineering/OBSERVABILITY.md).
 */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get("/health/live", async () => ({ status: "ok" as const }));

  app.get("/health/ready", async (_request, reply) => {
    const databaseHealthy = await deps.checkDatabaseHealth();
    if (!databaseHealthy) {
      reply.status(503);
      return { status: "error" as const, database: "unreachable" as const };
    }
    return { status: "ok" as const, database: "ok" as const };
  });
}
