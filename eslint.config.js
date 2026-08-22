// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.d.ts",
      // Build-tool config, deliberately outside every tsconfig's rootDir.
      "packages/database/drizzle.config.ts",
      // PM2 process definition, plain CommonJS, outside every tsconfig's rootDir.
      "deploy/pm2/ecosystem.config.cjs"
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
          "./apps/api/tsconfig.json",
          "./apps/worker/tsconfig.json"
        ]
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules,
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
