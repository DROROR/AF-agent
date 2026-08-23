import type { Evidence, PlaceholderType } from "@dyo/schemas";
import type { LayerFact } from "./project-facts.js";

export interface Classification {
  placeholderType: PlaceholderType;
  editable: boolean;
  evidence: Evidence;
}

/**
 * Pure, deterministic classification from structural facts only - no AE
 * connection, no I/O. Confidently assigns "text"/"video"/"image"/"color"
 * only when AE's own object model makes that unambiguous (a TextLayer IS a
 * text layer; footage with hasVideo=true IS video). "logo" and
 * "phone_screen" are never assigned here: nothing in AE's structure says
 * "this image is a logo" or "this layer is a phone screen" - that is
 * template-specific semantic judgment, not a structural fact, and
 * inventing it here would be exactly the kind of fabricated label this
 * project's instructions forbid ("do not invent semantic labels ... unless
 * the actual AE structure supports them"). Those two types can only be
 * assigned later, by a human during approval, or by an explicit
 * template-specific mapping supplied by the client - never by this
 * function guessing from a layer name.
 */
export function classifyPlaceholder(fact: LayerFact): Classification {
  if (fact.layerKind === "TextLayer") {
    return {
      placeholderType: "text",
      editable: true,
      evidence: { source: "read_directly", reason: "AE layer type is TextLayer" }
    };
  }

  if (fact.layerKind === "AVLayer" && fact.footage) {
    if (fact.footage.isMissing) {
      return {
        placeholderType: "unknown",
        editable: false,
        evidence: { source: "unknown", reason: "source footage is missing - cannot confirm placeholder type" }
      };
    }
    if (fact.footage.hasVideo) {
      return {
        placeholderType: "video",
        editable: true,
        evidence: { source: "read_directly", reason: "footage source reports hasVideo=true" }
      };
    }
    if (fact.footage.isStill) {
      return {
        placeholderType: "image",
        editable: true,
        evidence: { source: "read_directly", reason: "footage source is a still image (no video/audio track)" }
      };
    }
  }

  if (fact.solidFill?.isUniformSolidFill) {
    return {
      placeholderType: "color",
      editable: true,
      evidence: { source: "read_directly", reason: "layer is a single uniform solid fill with no other source" }
    };
  }

  return {
    placeholderType: "unknown",
    editable: false,
    evidence: { source: "unknown", reason: "no confident structural signal matched a known placeholder type" }
  };
}
