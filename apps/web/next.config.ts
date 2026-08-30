import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Real production bug, 2026-08-30: Next.js clones/buffers every
    // request body matched by middleware.ts (default cap 10MB) so both
    // middleware and the route handler can read it. The asset upload
    // route falls under that matcher, so any multipart upload over 10MB
    // was silently truncated before dyo-api's multipart parser ever saw
    // it - confirmed via Next's own logged warning ("Request body
    // exceeded 10MB for /api/projects/.../assets") lining up exactly
    // with dyo-api's "Part terminated early" 500s. 210mb (not 200mb)
    // because this cap bounds the whole multipart HTTP body (boundaries
    // + headers + file bytes), not just the file - nginx already caps
    // the full request at the same 210m, so this only removes Next's own
    // narrower inner cap; the backend's 200MB file-size limit is
    // untouched and remains the authoritative check.
    proxyClientMaxBodySize: "210mb"
  },
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
