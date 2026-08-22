import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      // @dyo/schemas' package.json "main" points at its TypeScript source
      // (src/index.ts), which internally uses NodeNext-style relative
      // imports with a .js extension (e.g. `export * from "./worker.js"`).
      // tsc and tsx resolve that .js specifier to the sibling .ts file
      // directly (that's what NodeNext module resolution is for), but
      // Turbopack's bundler-style resolution does not - it looks for a
      // literal worker.js file and fails. Point Turbopack at the package's
      // own compiled dist output instead, which contains real .js files.
      // This requires packages/schemas to be built first - see this
      // package's "predev"/"prebuild" scripts.
      "@dyo/schemas": "../../packages/schemas/dist/index.js"
    }
  }
};

export default nextConfig;
