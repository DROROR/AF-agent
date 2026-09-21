import type { ScannedSlotLayer } from "./build-slot-facts.js";
import type { TextCaptureStatus, TextVerification } from "@dyo/schemas";
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
  /**
   * AE's own `layer.enabled` (the visibility switch), from the project-wide
   * preflight scan. A disabled layer never renders, so it can never be a
   * real placeholder in the output - it is typically a designer's guide or
   * reference layer. Null when the scan produced no entry for this layer:
   * never assumed either way.
   */
  enabled: boolean | null;
  /** AE's own track-matte wiring for this layer, from the project scan. Absent/null when the scan did not read it - never assumed. */
  trackMatte?: TrackMatteFact | null;
  /** AE's own `layer.guideLayer`: a guide layer never renders in output. Null/absent when unread. */
  guideLayer?: boolean | null;
  /**
   * The untouched template layer's own text, in full, for a text layer -
   * `null` for any other layer kind, `undefined` when the scan did not report
   * it at all (an older worker build). Feeds the manifest's own `originalText`
   * (leftover-template-copy gate); never trimmed or normalised.
   */
  sourceText?: string | null | undefined;
  /** True when `sourceText` hit the scan's bound and is therefore a display-only excerpt, NOT the whole text. */
  sourceTextTruncated?: boolean | null | undefined;
  /** The COMPLETE text's own code-unit length, whether or not the text itself was bounded. */
  sourceTextCodeUnitLength?: number | null | undefined;
  /** Digests of the COMPLETE text, computed from the whole string (directly when it fits, or streamed from a slice-read when it does not) - see text-digest.ts. */
  sourceTextVerification?: TextVerification | undefined;
  /** How completely this layer's text was captured - COMPLETE, VERIFIED_EXCERPT, a transient CAPTURE_FAILED, or a terminal TOO_LARGE. */
  sourceTextCaptureStatus?: TextCaptureStatus | undefined;
  /** Nesting context by composition name, outermost first - empty if directly in the top-level composition. */
  layerPath: readonly string[];
  startTimeSeconds: number;
  durationSeconds: number;
}

export interface TrackMatteFact {
  /** This layer IS another layer's matte (it never renders itself). */
  isTrackMatte: boolean | null;
  /** This layer is cut by a matte. */
  hasTrackMatte: boolean | null;
  /** Index of the matte layer in the same composition; null on AE builds without `trackMatteLayer`, where the matte is the layer directly above. */
  matteLayerIndex: number | null;
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
  /**
   * This composition's own precomp-reference layers: the real, AE-confirmed
   * edges of the composition graph, in AE layer order.
   *
   * These layers are deliberately NOT in `layers` above - a precomp
   * reference wraps other content and is never itself an editable
   * placeholder. But the edge itself is what makes that content reachable,
   * and discarding it (as this previously did) is exactly why a template
   * whose editable content lives inside precomps produced a manifest with
   * almost nothing in it (real 2026-09-12 result on the Mixkit template:
   * 21 compositions, ~96 layers, 1 placeholder). build-manifest.ts walks
   * these to surface nested placeholders with a real layerPath.
   */
  precompChildren: readonly PrecompChildFact[];
}

/** One precomp-reference layer: which layer it is, and which composition it pulls in. */
export interface PrecompChildFact {
  /** AE's own layer.index within the PARENT composition. */
  layerIndex: number;
  /** The parent's own layer name for this reference - the human-meaningful hop name. */
  layerName: string;
  /** compositionId of the child composition this layer references. */
  sourceCompositionId: string;
  /**
   * AE's own `layer.enabled` for THIS precomp-reference layer, from the
   * project-wide scan. A disabled precomp layer never renders, so nothing
   * inside it can be a real placeholder in the output - build-manifest.ts
   * never descends through one (code review finding, 2026-09-13: without
   * this, a designer's hidden guide precomp surfaced its text/image layers as
   * approvable placeholders whose edits change nothing visible). Null when
   * the scan has no entry: never assumed either way.
   */
  enabled: boolean | null;
  /** Whether THIS precomp-reference layer is cut by a track matte - what makes its content a masked window (e.g. a phone screen). Null/absent when unread. */
  hasTrackMatte?: boolean | null;
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
  /**
   * The project-wide scan this was built from, keyed `comp-<id>:<layerIndex>`
   * (Stage 4). Carried through so slot semantics can read the geometry, matte
   * and animation facts of layers OTHER than the slot itself - its hosts, its
   * mattes and its siblings.
   *
   * REQUIRED, deliberately: when it was optional, `buildProjectFacts` consumed
   * it and forgot to return it, TypeScript stayed silent, and every structural
   * slot verdict in production came out `unknown` with no facts at all - while
   * the unit tests passed, because each one built the map itself. A scan that
   * did not run is an EMPTY map passed explicitly, never an absent field.
   */
  layerFactsByCompositionAndIndex: ReadonlyMap<string, ScannedSlotLayer>;
}
