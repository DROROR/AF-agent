import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/web's .tsx components use the automatic JSX runtime (no explicit
  // `import React` per file), matching how Next.js itself compiles them.
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "scripts/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts"
    ],
    setupFiles: ["./apps/web/src/test-utils/vitest-setup.ts"],
    // Comfortably above @testing-library's own async ceiling (5 s, see
    // apps/web/src/test-utils/vitest-setup.ts), so a genuinely stuck test
    // still fails as a timeout rather than hanging the run.
    passWithNoTests: false
  }
});
