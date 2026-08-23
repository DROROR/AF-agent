/**
 * The full, closed allowlist of read-only After Effects ExtendScript
 * object-model members INSPECT_TEMPLATE is permitted to query, once a real
 * execution transport exists (see template-inspector.ts for why none does
 * yet). CLAUDE.md Safety Rule 2: "Never execute arbitrary AI-generated JSX
 * in production. Only execute tested, versioned, allowlisted
 * scripts/operations."
 *
 * Every `aeApiPath` here is a standard, publicly documented Adobe After
 * Effects scripting property or method - not specific to this client's
 * ae-mcp installation, whose actual bridge/command protocol is a separate,
 * still-unknown thing (see docs/TEMPLATE-INSPECTOR.md). This list is a
 * boundary a future real executor must be validated against, not
 * executable code itself - nothing here opens a path to arbitrary JSX.
 *
 * Every entry is read-only by construction: property reads and
 * non-mutating enumeration only, never a setter, never a method that
 * creates/removes/moves/renders/saves anything.
 */
export interface AllowedInspectionQuery {
  /** Stable name a future executor would reference - not itself executable. */
  id: string;
  /** The standard AE ExtendScript object-model member this reads. */
  aeApiPath: string;
  description: string;
}

export const ALLOWED_INSPECTION_QUERIES: readonly AllowedInspectionQuery[] = [
  { id: "project.file", aeApiPath: "app.project.file", description: "Source .aep file path, for sourceProject.path." },
  { id: "project.items", aeApiPath: "app.project.items", description: "Enumerate every item (composition, footage, folder) in the project, in project-panel order." },
  { id: "app.version", aeApiPath: "app.version", description: "The running After Effects version string." },

  { id: "comp.name", aeApiPath: "CompItem.name", description: "Composition name." },
  { id: "comp.width", aeApiPath: "CompItem.width", description: "Composition width in pixels." },
  { id: "comp.height", aeApiPath: "CompItem.height", description: "Composition height in pixels." },
  { id: "comp.duration", aeApiPath: "CompItem.duration", description: "Composition duration in seconds." },
  { id: "comp.frameRate", aeApiPath: "CompItem.frameRate", description: "Composition frame rate." },
  { id: "comp.numLayers", aeApiPath: "CompItem.numLayers", description: "Layer count, for iterating comp.layer(i) in original order." },
  { id: "comp.usedIn", aeApiPath: "CompItem.usedIn", description: "Which other compositions reference this one - determines isNestedOnlyReferenced/parentCompositionIds." },

  { id: "layer.name", aeApiPath: "Layer.name", description: "Layer name (a machine fact, not a semantic label)." },
  { id: "layer.index", aeApiPath: "Layer.index", description: "Layer's 1-based index within its composition - used for stable, duplicate-name-safe placeholder IDs." },
  { id: "layer.inPoint", aeApiPath: "Layer.inPoint", description: "Layer start time." },
  { id: "layer.outPoint", aeApiPath: "Layer.outPoint", description: "Layer end time, together with inPoint gives duration." },
  { id: "layer.nullLayer", aeApiPath: "AVLayer.nullLayer", description: "Whether a layer is a null object (excluded from placeholder candidates)." },
  { id: "layer.source", aeApiPath: "AVLayer.source", description: "The footage/composition item this layer displays, if any." },

  { id: "textLayer.sourceText", aeApiPath: "TextLayer.sourceText", description: "Text content and font, for identifying text placeholders and fontsReferenced." },

  { id: "footageItem.hasVideo", aeApiPath: "FootageItem.hasVideo", description: "Whether a footage source has a video track." },
  { id: "footageItem.hasAudio", aeApiPath: "FootageItem.hasAudio", description: "Whether a footage source has an audio track." },
  { id: "footageItem.mainSource", aeApiPath: "FootageItem.mainSource", description: "Underlying source, used to detect a missing-footage placeholder." },
  { id: "footageItem.width", aeApiPath: "FootageItem.width", description: "Footage width in pixels, for placeholder dimensions." },
  { id: "footageItem.height", aeApiPath: "FootageItem.height", description: "Footage height in pixels, for placeholder dimensions." },
  { id: "footageSource.isMissing", aeApiPath: "FootageSource.isMissing", description: "Whether a footage source is missing on disk - for missingFootage." },

  { id: "layer.property.effects", aeApiPath: "Layer.property('ADBE Effect Parade')", description: "Applied effects/plugins on a layer, for pluginReferences." },

  { id: "shapeLayer.content", aeApiPath: "ShapeLayer.property('Contents')", description: "Shape layer fill contents, for detecting a uniform-solid-fill color placeholder." },
  { id: "avLayer.isSolid", aeApiPath: "AVLayer.source instanceof SolidSource", description: "Whether a layer's source is a solid color, for detecting a color placeholder." }
] as const;
