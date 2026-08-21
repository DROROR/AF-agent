import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
    passWithNoTests: false
  }
});
