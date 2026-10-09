/**
 * REAL 2026-10-09 (QA project `mega`, Mixkit "Polaroid Slideshow"): the
 * template's camera ("Camera 1", a CameraLayer) came out of inspection as a
 * placeholder with no type and `editable: false`, as every structural layer
 * does. The edit drawer offered it a picture anyway ("a kind this screen does
 * not know is offered everything"), the API stored the picture, the plan was
 * approved, and the first frame then failed with `Mapping "d5679e700cd25ba0"
 * has no resolved classification (null) - cannot derive an operation from it`
 * - a sentence no client can act on.
 *
 * The manifest already says which layers are not places for content:
 * `editable: false`. This is the one predicate every side reads - the drawer
 * (offers nothing), the edit (refuses), the approval gate (refuses) and the
 * dispatcher (refuses in the same words) - so they can never disagree again.
 */
export interface NonContentPlaceholderFacts {
  editable: boolean;
  layerName: string;
  sourceType: string | null;
}

/** True when the template reading says this layer is not a place for a client's picture or text. */
export function isNonContentPlaceholder(placeholder: Pick<NonContentPlaceholderFacts, "editable">): boolean {
  return placeholder.editable === false;
}

/** The layer's kind in a client's words, from After Effects' own layer type. */
export function describeLayerKindPlainly(sourceType: string | null): string {
  switch (sourceType) {
    case "CameraLayer":
      return "a camera";
    case "LightLayer":
      return "a light";
    case "ShapeLayer":
      return "a shape";
    default:
      return "a helper layer";
  }
}

/** One sentence a person can act on: which layer, what it is, and what to do. */
export function describeNonContentPlaceholderRefusal(placeholder: NonContentPlaceholderFacts, what: "a picture" | "text" | "a picture or text"): string {
  return `"${placeholder.layerName}" is part of the template's own setup (${describeLayerKindPlainly(placeholder.sourceType)}) and cannot hold ${what} - remove ${what === "text" ? "the text" : "the picture"} from it on the Scenes tab`;
}

/** Whether a plan mapping carries anything a non-content layer could not take. */
export function mappingCarriesContent(mapping: { selectedAssetId: string | null; text: string | null }): "a picture" | "text" | null {
  if (mapping.selectedAssetId !== null) {
    return "a picture";
  }
  if (mapping.text !== null && mapping.text.trim() !== "") {
    return "text";
  }
  return null;
}
