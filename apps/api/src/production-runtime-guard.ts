import type { Env } from "./env.js";

/**
 * Refuses to start when NODE_ENV=production but this process was not
 * launched by the managed production entrypoint (PM2 - see
 * deploy/pm2/ecosystem.config.cjs) and no explicit escape hatch was set.
 *
 * Prompted by the 2026-08-26 incident: a manually-launched
 * `tsx apps/api/src/index.ts` process was left running outside PM2 and
 * silently occupied the real production port. Every subsequent legitimate
 * PM2-managed deploy then failed to bind that port (EADDRINUSE) and
 * crash-looped invisibly in the background, while the stale manual
 * process kept answering health checks and real traffic with old code -
 * including, that day, approving a real customer's unresolved execution
 * plan. This guard makes that exact class of mistake fail loudly and
 * immediately at startup instead.
 *
 * Deliberately does NOT rely on NODE_ENV alone to decide whether a launch
 * is legitimate (a manually-started process can just as easily have
 * NODE_ENV=production set too) - the actual legitimacy check is
 * `pm2Id !== undefined`, the PM2-injected `pm_id` environment variable
 * that only ever exists in a PM2-managed child process and cannot be
 * faked by a plain shell export. NODE_ENV only decides whether this guard
 * applies at all, so it never blocks `npm run dev` or the test suite
 * (which builds the app directly via buildApp(), never through main()
 * here, so it is unaffected regardless of NODE_ENV).
 */
export function assertManagedRuntime(
  env: Pick<Env, "NODE_ENV" | "ALLOW_UNMANAGED_PRODUCTION_START">,
  pm2Id: string | undefined
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  if (pm2Id !== undefined) {
    return;
  }
  if (env.ALLOW_UNMANAGED_PRODUCTION_START) {
    return;
  }
  throw new UnmanagedProductionStartError();
}

export class UnmanagedProductionStartError extends Error {
  constructor() {
    super(
      "Refusing to start: NODE_ENV=production but this process was not launched by PM2 " +
        "(the managed production entrypoint - see deploy/pm2/ecosystem.config.cjs) and " +
        "ALLOW_UNMANAGED_PRODUCTION_START was not set. Manually launching a production API " +
        "process outside PM2 can silently occupy the real port while PM2's own managed " +
        "process fails to bind it and crash-loops invisibly in the background - use " +
        "`pm2 startOrReload deploy/pm2/ecosystem.config.cjs --only dyo-api` instead. If you " +
        "genuinely intend a one-off manual production diagnostic run, set " +
        "ALLOW_UNMANAGED_PRODUCTION_START=1 explicitly and deliberately."
    );
    this.name = "UnmanagedProductionStartError";
  }
}
