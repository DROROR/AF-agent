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
    passWithNoTests: false
  }
});
