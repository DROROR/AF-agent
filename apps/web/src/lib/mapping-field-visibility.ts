/**
 * Which inputs a layer's section of the edit drawer offers.
 *
 * Real complaint, 2026-10-02: every layer showed the same three inputs - an
 * asset picker, a text box and an asset timestamp - so a text layer offered
 * a file picker, an image slot offered a text box, and nobody could tell what
 * a layer actually took. A layer now offers what its own kind can hold.
 *
 * A value that is ALREADY set is always shown, whatever the kind, so nothing
 * saved before this rule existed becomes impossible to see or clear.
 */
export interface MappingFieldVisibility {
  asset: boolean;
  text: boolean;
  timestamp: boolean;
}

export interface MappingCurrentValues {
  hasAsset: boolean;
  hasText: boolean;
  hasTimestamp: boolean;
}

const STILL_KINDS: ReadonlySet<string> = new Set(["image", "logo", "phone_screen"]);

/**
 * REAL 2026-10-09: the template's camera - no kind, "offered everything" - was
 * given a picture, and the first frame failed. A layer the template reading
 * marks as not a place for content (`editable: false`, see @dyo/schemas
 * non-content-placeholder.ts) offers nothing; a value already saved on it is
 * still shown so it can be cleared.
 */
export function fieldsForLayerKind(kind: string | null, current: MappingCurrentValues, options: { nonContent?: boolean } = {}): MappingFieldVisibility {
  const base: MappingFieldVisibility = options.nonContent
    ? { asset: false, text: false, timestamp: false }
    : kind === "text"
      ? { asset: false, text: true, timestamp: false }
      : kind === "video"
        ? { asset: true, text: false, timestamp: true }
        : kind !== null && STILL_KINDS.has(kind)
          ? { asset: true, text: false, timestamp: false }
          : kind === "color"
            ? { asset: false, text: false, timestamp: false }
            : // A kind this screen does not know is offered everything, never nothing.
              { asset: true, text: true, timestamp: true };
  return {
    asset: base.asset || current.hasAsset,
    text: base.text || current.hasText,
    timestamp: base.timestamp || current.hasTimestamp
  };
}
