/**
 * Defensive parsers for the REAL, confirmed response shapes of this
 * worker's allowlisted read-only ae-mcp tools. Every parser returns a
 * typed failure instead of throwing when a field is missing or
 * mistyped, and never invents a value that wasn't actually present -
 * "null/unknown remain null/unknown" (Phase 5 requirement).
 *
 * ae_health / ae_list_instances / ae_get_project_info / ae_list_compositions'
 * shapes were confirmed directly from a real successful INSPECT_TEMPLATE
 * job's captured output (2026-08-26, worker 345ee0a4-ef4d-4b87-a923-726f97144aa4).
 * ae_get_composition's shape was confirmed by reading the real upstream
 * HeroicSwan/after-effects-mcp host-side implementation
 * (`host-scripts/ae-mcp-methods.jsx`'s `compSummary`/`layerSummary`
 * functions, fetched directly from the upstream repository - never
 * guessed), not from a real captured sample of that specific tool.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A real MCP text-content block is never larger than this in practice; a bigger one fails closed instead of risking unbounded JSON.parse work on a malformed/hostile response. */
const MAX_SAFE_PARSE_CHARS = 5_000_000;

/** Every allowlisted tool's real response is one MCP `content` array of `{type: "text", text: "<JSON string>"}` blocks (confirmed from the real capture). */
function parseJsonTextContent(content: unknown): ParseResult<unknown> {
  if (!Array.isArray(content) || content.length === 0) {
    return { ok: false, reason: "content is not a non-empty array" };
  }
  const textBlock = content.find(
    (block): block is { type: "text"; text: string } =>
      isRecord(block) && block["type"] === "text" && typeof block["text"] === "string"
  );
  if (!textBlock) {
    return { ok: false, reason: 'no {type: "text", text} block found in content' };
  }
  if (textBlock.text.length > MAX_SAFE_PARSE_CHARS) {
    return { ok: false, reason: "text block exceeds the safe parse size limit" };
  }
  try {
    return { ok: true, value: JSON.parse(textBlock.text) };
  } catch (error) {
    return { ok: false, reason: `text block is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Real confirmed shape of one entry in ae_get_project_info's/ae_list_compositions' `compositions`/bare-array items - identical fields in both. */
export interface CompositionSummary {
  index: number;
  name: string;
  widthPx: number;
  heightPx: number;
  frameRate: number;
  durationSeconds: number;
  numLayers: number;
}

function parseCompositionSummary(raw: unknown): CompositionSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { index, name, width, height, frameRate, duration, numLayers } = raw;
  if (
    typeof index !== "number" ||
    typeof name !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof frameRate !== "number" ||
    typeof duration !== "number" ||
    typeof numLayers !== "number"
  ) {
    return null;
  }
  return { index, name, widthPx: width, heightPx: height, frameRate, durationSeconds: duration, numLayers };
}

export interface ProjectInfo {
  /** AE's own self-reported name/path for the currently open project - diagnostic only, never the manifest's sourceProject (see hash-source-project.ts). */
  aeReportedName: string | null;
  aeReportedPath: string | null;
  compositions: CompositionSummary[];
}

/** Parses ae_get_project_info's real confirmed shape: {name, path, bitsPerChannel, numItems, compositions: CompositionSummary[]}. */
export function parseProjectInfo(content: unknown): ParseResult<ProjectInfo> {
  const parsed = parseJsonTextContent(content);
  if (!parsed.ok) {
    return parsed;
  }
  const raw = parsed.value;
  if (!isRecord(raw) || !Array.isArray(raw["compositions"])) {
    return { ok: false, reason: "expected an object with a compositions array" };
  }
  const compositions: CompositionSummary[] = [];
  for (const item of raw["compositions"]) {
    const summary = parseCompositionSummary(item);
    if (!summary) {
      return { ok: false, reason: "a composition entry did not match the confirmed shape" };
    }
    compositions.push(summary);
  }
  return {
    ok: true,
    value: {
      aeReportedName: typeof raw["name"] === "string" ? raw["name"] : null,
      aeReportedPath: typeof raw["path"] === "string" ? raw["path"] : null,
      compositions
    }
  };
}

/** Parses ae_list_compositions' real confirmed shape: a bare CompositionSummary[] array. */
export function parseCompositionList(content: unknown): ParseResult<CompositionSummary[]> {
  const parsed = parseJsonTextContent(content);
  if (!parsed.ok) {
    return parsed;
  }
  if (!Array.isArray(parsed.value)) {
    return { ok: false, reason: "expected a bare array" };
  }
  const compositions: CompositionSummary[] = [];
  for (const item of parsed.value) {
    const summary = parseCompositionSummary(item);
    if (!summary) {
      return { ok: false, reason: "a composition entry did not match the confirmed shape" };
    }
    compositions.push(summary);
  }
  return { ok: true, value: compositions };
}

/** Parses ae_health's real confirmed shape, extracting only the one fact this worker needs from it: the running AE version (health.aeVersion). */
export function parseAeVersionFromHealth(content: unknown): ParseResult<string | null> {
  const parsed = parseJsonTextContent(content);
  if (!parsed.ok) {
    return parsed;
  }
  const raw = parsed.value;
  if (!isRecord(raw)) {
    return { ok: false, reason: "expected an object" };
  }
  const health = isRecord(raw["health"]) ? raw["health"] : null;
  const version = health && typeof health["aeVersion"] === "string" ? health["aeVersion"] : null;
  return { ok: true, value: version };
}

/**
 * Real confirmed shape of one entry in ae_get_composition's nested
 * `layers` array. `compSummary` always calls `layerSummary(layer, false)`
 * for these (see host-scripts/ae-mcp-methods.jsx upstream) - so ONLY
 * these fields are ever present here, never position/scale/rotation/
 * opacity/effects, which exist only behind a direct per-layer detailed
 * call (`ae_get_layer` or similar) this worker's allowlist does not
 * include and never calls.
 */
export interface LayerSummary {
  index: number;
  name: string;
  inPointSeconds: number;
  outPointSeconds: number;
  nullLayer: boolean;
}

function parseLayerSummary(raw: unknown): LayerSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { index, name, inPoint, outPoint, nullLayer } = raw;
  if (
    typeof index !== "number" ||
    typeof name !== "string" ||
    typeof inPoint !== "number" ||
    typeof outPoint !== "number" ||
    typeof nullLayer !== "boolean"
  ) {
    return null;
  }
  return { index, name, inPointSeconds: inPoint, outPointSeconds: outPoint, nullLayer };
}

export interface CompositionDetail {
  /** AE's own persistent comp.id - confirmed present in ae_get_composition's real response, absent from ae_list_compositions/ae_get_project_info's summaries. More stable than the project-item index (survives item reordering). */
  compId: number | null;
  name: string;
  widthPx: number;
  heightPx: number;
  frameRate: number;
  durationSeconds: number;
  numLayers: number;
  /** Present only when the tool actually returned a layers array (called with response_format: "detailed"). */
  layers: LayerSummary[] | null;
}

/** Parses ae_get_composition's real confirmed shape (see module doc comment for how it was confirmed). */
export function parseCompositionDetail(content: unknown): ParseResult<CompositionDetail> {
  const parsed = parseJsonTextContent(content);
  if (!parsed.ok) {
    return parsed;
  }
  const raw = parsed.value;
  if (!isRecord(raw)) {
    return { ok: false, reason: "expected an object" };
  }
  const { name, width, height, frameRate, duration, numLayers, id } = raw;
  if (
    typeof name !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof frameRate !== "number" ||
    typeof duration !== "number" ||
    typeof numLayers !== "number"
  ) {
    return { ok: false, reason: "response did not match the confirmed comp.get shape" };
  }

  let layers: LayerSummary[] | null = null;
  if (Array.isArray(raw["layers"])) {
    layers = [];
    for (const item of raw["layers"]) {
      const layer = parseLayerSummary(item);
      if (!layer) {
        return { ok: false, reason: "a layers[] entry did not match the confirmed layerSummary shape" };
      }
      layers.push(layer);
    }
  }

  return {
    ok: true,
    value: {
      compId: typeof id === "number" ? id : null,
      name,
      widthPx: width,
      heightPx: height,
      frameRate,
      durationSeconds: duration,
      numLayers,
      layers
    }
  };
}
