import { vi } from "vitest";

/**
 * Global test setup (2026-09-18).
 *
 * WHY THIS EXISTS: `@testing-library`'s own default async timeout is 1000 ms of
 * wall-clock time. That is ample for one component test on its own, but the full
 * suite runs hundreds of files across parallel worker threads, so a jsdom render
 * plus a stubbed fetch round-trip can genuinely take longer than a second on a
 * loaded machine. The result was a test that passed in isolation and failed
 * intermittently in the full run - a false failure that says nothing about the
 * code under test.
 *
 * Raising the ceiling never makes a real failure pass: a query that will never
 * match still fails, just after a longer wait.
 *
 * DELIBERATELY SCOPED TO DOM TESTS ONLY. `vi.setConfig` here applies per test
 * file, so the node-environment suites keep Vitest's own default timeout
 * exactly as before - several of them (the template-inspector hang/polling
 * tests in particular) exercise real bounded time budgets and set their own
 * per-test timeouts, and a raised global default measurably disturbed them.
 */
if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/dom");
  configure({ asyncUtilTimeout: 5000 });
  // Comfortably above that async ceiling, so a genuinely stuck DOM test still
  // fails as a timeout rather than hanging the run.
  vi.setConfig({ testTimeout: 20000 });
}
