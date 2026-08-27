/**
 * Structural facts about an AE project, as they would be extracted by a
 * real read-only inspection execution once a bridge/transport exists (see
 * template-inspector.ts). This module defines the SHAPE of that input only
 * - nothing here executes anything or talks to After Effects.
 *
 * Deliberately generic/structural, not AE-API-shaped 1:1: this is the
 * boundary a real executor would translate raw ae-mcp/JSX query results
 * into, so build-manifest.ts and classify-placeholder.ts can be fully
 * tested with synthetic fixtures, independent of any real AE connection.
 */

export type AeLayerKind = "TextLayer" | "ShapeLayer" | "AVLayer" | "CameraLayer" | "LightLayer" | "Unknown";

export interface FootageFact {
  hasVideo: boolean;
  hasAudio: boolean;
  isStill: boolean;
  isMissing: boolean;
  widthPx: number | null;
  heightPx: number | null;
}

export interface SolidFillFact {
  isUniformSolidFill: boolean;
}

export interface LayerFact {
  name: string;
  /** AE's own layer.index - always present, used to disambiguate duplicate layer names. */
  index: number;
  layerKind: AeLayerKind;
  /** Set only when the layer's source is a footage item (AVLayer). */
  footage: FootageFact | null;
  /** Set only when the layer is a solid/shape with a single uniform fill and no other source. */
  solidFill: SolidFillFact | null;
  /** Nesting context by composition name, outermost first - empty if directly in the top-level composition. */
  layerPath: readonly string[];
  startTimeSeconds: number;
  durationSeconds: number;
}

export interface CompositionFact {
  compositionId: string;
  /** Raw, 1-based app.project.item(n) position - the SAME runtime locator ae_get_composition/ae_get_layer's own comp_index expects (confirmed directly from the real upstream host script - see execute-scene-edit.ts's own doc comment). Carried through onto the manifest so a later render-configuration step can durably reference it, rather than only ever existing transiently during inspection. */
  aeProjectItemIndex: number;
  name: string;
  widthPx: number;
  heightPx: number;
  durationSeconds: number;
  frameRate: number;
  /** True if this composition is only ever referenced as a nested layer source, never a top-level scene candidate. */
  isNestedOnlyReferenced: boolean;
  parentCompositionIds: readonly string[];
  /** In original AE layer order - never re-sorted. */
  layers: readonly LayerFact[];
}

export interface MissingFootageFact {
  name: string;
  expectedPath: string | null;
}

export interface ProjectFacts {
  templateId: string;
  templateName: string;
  aeVersion: string | null;
  sourceProjectPath: string;
  sourceProjectName: string;
  /** SHA-256 of the source .aep, computed before inspection - CLAUDE.md Safety Rule 8. */
  projectSha256: string;
  /** In original AE project-panel order - never re-sorted. */
  compositions: readonly CompositionFact[];
  requiredFonts: readonly string[];
  footageReferenced: readonly string[];
  missingFootage: readonly MissingFootageFact[];
  pluginReferences: readonly string[];
}
