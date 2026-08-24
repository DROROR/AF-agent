// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/*.d.ts",
      // Build-tool config, deliberately outside every tsconfig's rootDir.
      "packages/database/drizzle.config.ts",
      // PM2 process definition, plain CommonJS, outside every tsconfig's rootDir.
      "deploy/pm2/ecosystem.config.cjs",
      // Windows worker packaging/deployment tooling, plain JS, outside every tsconfig's rootDir.
      "scripts/package-windows-worker.mjs",
      "scripts/windows-worker-format-status.mjs",
      "scripts/windows-worker-validate-env.mjs",
      // Regenerated build artifact - see deploy/windows-worker/worker-app/ in .gitignore.
      "deploy/windows-worker/worker-app/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./packages/schemas/tsconfig.json",
          "./packages/database/tsconfig.json",
          "./packages/renderer/tsconfig.json",
          "./apps/api/tsconfig.json",
          "./apps/worker/tsconfig.json",
          "./apps/web/tsconfig.json"
        ],
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      // TypeScript itself (via tsc, run separately as `npm run typecheck`)
      // already catches real undefined-variable errors, and understands
      // Node/DOM globals + type-only namespaces (e.g. `NodeJS`) that this
      // untyped rule does not - see typescript-eslint's own guidance to
      // disable no-undef in .ts files.
      "no-undef": "off"
    }
  },
  prettierConfig
];
