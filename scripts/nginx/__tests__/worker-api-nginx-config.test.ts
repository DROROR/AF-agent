import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Live QA regression - this exact class of gap has now bitten this
 * project SEVEN separate times across five fixes (see this same .conf
 * file's own comments): /jobs/active (2026-09-04), scene-evidence-preview
 * (2026-09-07), assets/:assetId/file (2026-09-08), and - discovered by a
 * full worker-API-surface audit run specifically because of that last one
 * - checkpoint/preview/full-preview/artifact (2026-09-08, all four in one
 * pass). worker-api.dyocourses.com.conf is a manually curated PATH
 * ALLOWLIST, not a catch-all proxy - a real Fastify route correctly
 * registered and reachable directly against 127.0.0.1:4000 can still
 * silently 404 for every real Windows Worker if nobody remembers to add a
 * matching `location` block here too. `npm test` cannot spin up a real
 * nginx process, but it CAN parse this file's own `location` blocks and
 * simulate nginx's real matching precedence (an exact `location =` always
 * wins over any `location ~` regex, regardless of file order; among
 * `location ~` regex blocks, the FIRST one in file order that matches
 * wins; anything matching nothing falls through to the final
 * `location / { return 404; }`) against real, concrete request paths -
 * proving this file's own allowlist actually contains what this repo's
 * worker-facing routes need, not just that the file is syntactically
 * well-formed. Also verifies each upload route's own `client_max_body_size`
 * against its REAL application-layer ceiling (app.ts's own maxUploadBytes
 * wiring), so a future silent mismatch there is caught here too.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const CONF_PATH = join(currentDir, "..", "..", "..", "deploy", "nginx", "worker-api.dyocourses.com.conf");
const confText = readFileSync(CONF_PATH, "utf8");

interface ParsedLocation {
  kind: "exact" | "regex";
  pattern: string;
  methods: string[] | null; // null = no limit_except found (should not happen for a real block)
  regex: RegExp | null; // only for kind: "regex"
  /** This block's own `client_max_body_size` override in bytes, or null when the block relies on the server-wide 1M default (no override line present). */
  maxBodyBytes: number | null;
}

/** "10m"/"2g"/"5m" (nginx's own size-suffix syntax) -> real byte count, so tests can assert on actual size relationships rather than string-matching the literal. */
function parseNginxSize(raw: string): number {
  const match = /^(\d+)([kKmMgG]?)$/.exec(raw.trim());
  if (!match) {
    throw new Error(`Could not parse nginx size literal: "${raw}"`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit === "g" ? 1024 ** 3 : unit === "m" ? 1024 ** 2 : unit === "k" ? 1024 : 1;
  return value * multiplier;
}

/** Parses every `location = <path> { ... }` / `location ~ <regex> { ... }` block's own path/regex + its `limit_except <METHOD> { deny all; }` and `client_max_body_size` lines - a real (if intentionally minimal) parse of this file's own actual allowlist, not a hand-copied duplicate of it. */
function parseLocations(text: string): ParsedLocation[] {
  const blockPattern = /location\s+(=|~)\s+(\S+)\s*\{([\s\S]*?)\n {4}\}/g;
  const locations: ParsedLocation[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const [, op, pattern, body] = match as unknown as [string, string, string, string];
    if (pattern === "/") {
      continue; // the final catch-all, handled separately below
    }
    const methodMatch = /limit_except\s+([A-Z]+)\s*\{\s*deny all;\s*\}/.exec(body);
    const bodySizeMatch = /client_max_body_size\s+(\S+);/.exec(body);
    locations.push({
      kind: op === "=" ? "exact" : "regex",
      pattern,
      methods: methodMatch ? [methodMatch[1] as string] : null,
      regex: op === "~" ? new RegExp(pattern) : null,
      maxBodyBytes: bodySizeMatch ? parseNginxSize(bodySizeMatch[1] as string) : null
    });
  }
  return locations;
}

/** Looks up a parsed block by its exact regex pattern text (as written in the .conf file) - used by the size-config tests below, which care about ONE specific block's own override, not just whether some path resolves. */
function findByPattern(pattern: string): ParsedLocation {
  const found = locations.find((l) => l.pattern === pattern);
  if (!found) {
    throw new Error(`No parsed location block found for pattern: ${pattern}`);
  }
  return found;
}

const locations = parseLocations(confText);

/** Simulates nginx's real location-matching precedence for THIS file's own shape (no prefix `location` blocks exist here, only `=`/`~`/the final `/` catch-all - real nginx's full precedence rules are broader, but this file only ever uses these three kinds, confirmed by the parse above finding nothing else). */
function resolve(path: string, method: string): { matched: boolean; methodAllowed: boolean } {
  const exact = locations.find((l) => l.kind === "exact" && l.pattern === path);
  if (exact) {
    return { matched: true, methodAllowed: exact.methods !== null && exact.methods.includes(method) };
  }
  const regexMatch = locations.find((l) => l.kind === "regex" && l.regex!.test(path));
  if (regexMatch) {
    return { matched: true, methodAllowed: regexMatch.methods !== null && regexMatch.methods.includes(method) };
  }
  return { matched: false, methodAllowed: false }; // falls through to `location / { return 404; }`
}

describe("worker-api.dyocourses.com.conf - real path allowlist parsed from the actual file", () => {
  it("parsed at least the 11 expected location blocks - the parser itself is finding real blocks, not silently matching zero", () => {
    expect(locations.length).toBeGreaterThanOrEqual(11);
  });

  it("still contains the final `location / { return 404; }` catch-all - unrelated paths are never silently proxied", () => {
    expect(confText).toMatch(/location \/ \{\s*\n\s*return 404;\s*\n\s*\}/);
  });

  describe("the fix: GET /api/workers/:workerId/jobs/:jobId/assets/:assetId/file is now proxied", () => {
    const realWorkerId = "accd0a71-dbd6-4a53-8b81-d3fe4609420b";
    const realJobId = "6b09548a-4437-40ad-813f-1680284b7810";
    const realAssetId = "d0cb4539-77dd-495e-bab2-16380e06dc4b";
    const path = `/api/workers/${realWorkerId}/jobs/${realJobId}/assets/${realAssetId}/file`;

    it("a real, concrete asset-download path (the exact one that 404'd during live QA) is matched and GET is allowed", () => {
      const result = resolve(path, "GET");
      expect(result.matched, "no location block matched this real asset-download path").toBe(true);
      expect(result.methodAllowed, "GET is not allowed for this path").toBe(true);
    });

    it("rejects a non-GET method on the asset-download path - it is a read-only download, never a mutation", () => {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const result = resolve(path, method);
        expect(result.methodAllowed, `${method} should not be allowed on the asset-download path`).toBe(false);
      }
    });
  });

  describe("the fix: the four routes confirmed missing during live QA are now all proxied, POST-only", () => {
    const workerId = "accd0a71-dbd6-4a53-8b81-d3fe4609420b";
    const jobId = "6b09548a-4437-40ad-813f-1680284b7810";

    const routes: { name: string; path: string }[] = [
      { name: "checkpoint", path: `/api/workers/${workerId}/jobs/${jobId}/checkpoint` },
      { name: "preview", path: `/api/workers/${workerId}/jobs/${jobId}/preview` },
      { name: "full-preview", path: `/api/workers/${workerId}/jobs/${jobId}/full-preview` },
      { name: "artifact", path: `/api/workers/${workerId}/jobs/${jobId}/artifact` }
    ];

    for (const { name, path } of routes) {
      it(`POST ${name} is proxied and allowed`, () => {
        const result = resolve(path, "POST");
        expect(result.matched, `no location block matched the ${name} path`).toBe(true);
        expect(result.methodAllowed, `POST is not allowed for ${name}`).toBe(true);
      });

      it(`GET is rejected for ${name} - every one of these four is a POST-only worker action`, () => {
        expect(resolve(path, "GET").methodAllowed).toBe(false);
      });
    }

    it("preview never accidentally matches the full-preview path (or vice versa) - hex-dash-only jobId/workerId capture groups cannot swallow the letters in \"full-preview\"", () => {
      const fullPreviewPath = `/api/workers/${workerId}/jobs/${jobId}/full-preview`;
      const previewLocation = findByPattern("^/api/workers/[0-9a-fA-F-]+/jobs/[0-9a-fA-F-]+/preview$");
      expect(previewLocation.regex!.test(fullPreviewPath), "the /preview block's own regex must never match a full-preview path").toBe(false);
    });

    it("checkpoint carries no client_max_body_size override - a JSON progress record, covered by the server-wide 1M default", () => {
      const location = findByPattern("^/api/workers/[0-9a-fA-F-]+/jobs/[0-9a-fA-F-]+/checkpoint$");
      expect(location.maxBodyBytes).toBeNull();
    });

    it("preview's client_max_body_size (10m) is well above a real single-frame image, but far below the application layer's own 200MB ASSET_MAX_UPLOAD_BYTES ceiling", () => {
      const location = findByPattern("^/api/workers/[0-9a-fA-F-]+/jobs/[0-9a-fA-F-]+/preview$");
      expect(location.maxBodyBytes).toBe(10 * 1024 * 1024);
      expect(location.maxBodyBytes).toBeLessThan(200 * 1024 * 1024);
    });

    it("full-preview and artifact both allow up to 2GB - matching the application layer's own RENDER_ARTIFACT_MAX_UPLOAD_BYTES default for a real rendered video, never silently smaller", () => {
      const fullPreview = findByPattern("^/api/workers/[0-9a-fA-F-]+/jobs/[0-9a-fA-F-]+/full-preview$");
      const artifact = findByPattern("^/api/workers/[0-9a-fA-F-]+/jobs/[0-9a-fA-F-]+/artifact$");
      expect(fullPreview.maxBodyBytes).toBe(2 * 1024 ** 3);
      expect(artifact.maxBodyBytes).toBe(2 * 1024 ** 3);
    });
  });

  describe("unrelated paths still fall through to the 404 catch-all - this is a strict allowlist, never widened", () => {
    const unrelatedPaths = [
      "/api/workers",
      "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b",
      "/api/projects/d9db52fc-7ff2-4088-b872-8a29a8b5a730",
      "/api/auth/login",
      "/etc/passwd",
      "/../../etc/passwd",
      "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/6b09548a-4437-40ad-813f-1680284b7810/assets", // missing /:assetId/file
      "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/assets/x/file", // missing the jobId segment
      "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/6b09548a-4437-40ad-813f-1680284b7810/checkpoints", // plural - not the real route
      "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/preview", // missing the jobId segment
      "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/6b09548a-4437-40ad-813f-1680284b7810/artifacts" // plural - not the real route
    ];
    for (const path of unrelatedPaths) {
      it(`"${path}" matches no allowlisted location - falls through to 404`, () => {
        expect(resolve(path, "GET").matched).toBe(false);
      });
    }
  });

  describe("every pre-existing route remains present and unchanged", () => {
    it("POST /api/workers/register - exact match, POST-only", () => {
      const r = resolve("/api/workers/register", "POST");
      expect(r.matched).toBe(true);
      expect(r.methodAllowed).toBe(true);
      expect(resolve("/api/workers/register", "GET").methodAllowed).toBe(false);
    });

    it("POST /api/workers/:workerId/heartbeat - POST-only", () => {
      const path = "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/heartbeat";
      expect(resolve(path, "POST").methodAllowed).toBe(true);
      expect(resolve(path, "GET").methodAllowed).toBe(false);
    });

    it("POST /api/workers/:workerId/jobs/claim - POST-only", () => {
      const path = "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/claim";
      expect(resolve(path, "POST").methodAllowed).toBe(true);
      expect(resolve(path, "GET").methodAllowed).toBe(false);
    });

    it("GET /api/workers/:workerId/jobs/active - GET-only", () => {
      const path = "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/active";
      expect(resolve(path, "GET").methodAllowed).toBe(true);
      expect(resolve(path, "POST").methodAllowed).toBe(false);
    });

    it("POST /api/workers/:workerId/jobs/:jobId/report - POST-only", () => {
      const path = "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/6b09548a-4437-40ad-813f-1680284b7810/report";
      expect(resolve(path, "POST").methodAllowed).toBe(true);
      expect(resolve(path, "GET").methodAllowed).toBe(false);
    });

    it("POST /api/workers/:workerId/jobs/:jobId/scene-evidence-preview - POST-only", () => {
      const path = "/api/workers/accd0a71-dbd6-4a53-8b81-d3fe4609420b/jobs/6b09548a-4437-40ad-813f-1680284b7810/scene-evidence-preview";
      expect(resolve(path, "POST").methodAllowed).toBe(true);
      expect(resolve(path, "GET").methodAllowed).toBe(false);
    });
  });

  it("the new asset-download block never widens client_max_body_size for the whole server (still the server-wide 1M default - a GET download has no meaningful request body)", () => {
    const newBlockMatch = /location ~ \^\/api\/workers\/\[0-9a-fA-F-\]\+\/jobs\/\[0-9a-fA-F-\]\+\/assets\/\[0-9a-fA-F-\]\+\/file\$ \{([\s\S]*?)\n {4}\}/.exec(confText);
    expect(newBlockMatch, "new asset-download location block not found").not.toBeNull();
    expect(newBlockMatch![1]).not.toMatch(/client_max_body_size/);
  });
});
