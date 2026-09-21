# Core Schemas

## template-manifest.json
Machine generated. Illustrative shape:

```json
{
  "schemaVersion": "1.0",
  "templateId": "...",
  "sourceProject": {
    "name": "template.aep",
    "sha256": "..."
  },
  "afterEffects": {
    "version": "26.x"
  },
  "preflight": {
    "missingFootage": [],
    "requiredFonts": [],
    "pluginReferences": []
  },
  "scenes": [
    {
      "sceneId": "scene_...",
      "displayName": "Scene 05",
      "sourceCompId": "...",
      "sourceStartSeconds": 0,
      "sourceDurationSeconds": 4,
      "placeholders": [
        {
          "placeholderId": "ph_...",
          "displayLabel": "Left Phone",
          "type": "image_or_video",
          "layerPath": ["..."],
          "metadata": {}
        }
      ]
    }
  ]
}
```

## execution-plan.json
Human-approved. Illustrative shape:

```json
{
  "schemaVersion": "1.0",
  "templateId": "...",
  "approval": {
    "status": "approved",
    "approvedAt": "..."
  },
  "frames": [
    {
      "finalOrder": 1,
      "sceneId": "scene_...",
      "enabled": true,
      "finalDurationSeconds": 4,
      "assignments": [
        {
          "placeholderId": "ph_...",
          "assetId": "asset_...",
          "text": null,
          "videoTimestampSeconds": 12.4,
          "instruction": null
        }
      ]
    }
  ]
}
```

## dyo-brand-rules.yaml
Illustrative:

```yaml
schemaVersion: "1.0"
dyo:
  officialBlue: "#SET_FROM_APPROVED_SOURCE"
  bylineHebrew: "מבית DYO App"
  requireDyoByline: true
client:
  requireClientLogoAtLeastOnce: true
colorSafety:
  excludeClientScreenshots: true
  excludeClientLogos: true
  excludePhoneHardware: true
```

The actual official DYO blue must come from an approved source/configuration; do not invent it.

## text-direction (bidirectional text)

`packages/schemas/src/text-direction.ts` is pure, shared and has no AE or
template knowledge:

- `analyseTextDirection(text) -> TextDirectionAnalysis` - `requiredDirection`
  (`RTL` / `LTR` / `NEUTRAL`, taken from the first strong character per UAX #9
  P2/P3), `hasRtl`, `hasStrongLtr`, `requiresBidiHandling` (any RTL character
  present), `isMixed`, `rtlScripts`, character counts, and
  `codeUnitCount`/`codePointCount`.
- `textCodeUnits(text) -> number[]` - the exact UTF-16 sequence a mutation
  must find in the project afterwards (order-sensitive, so reversed text can
  never verify as equal).
- `textDirectionEvidenceSchema` - what one SET_TEXT operation reports back:
  base direction, RTL scripts, mixed flag, `requiresBidiHandling`, previous and applied
  direction/composer, `directionVerified`, `composerVerified`,
  `textCodeUnitsVerified`, `codeUnitCount` and an optional `note`.

`sceneEditResultSchema.textDirectionEvidence` carries one such record per
SET_TEXT operation, each tagged with its `operationIndex`. It **defaults to
`[]`**, so stored results and older workers' results remain readable without
migration; the API and database need no change to accept it.

## template-copy (leftover template wording)

`packages/schemas/src/template-copy.ts`:

- `assessTemplateCopy({ mappingText, templateText, decision }) -> TemplateCopyAssessment`
  with `status`, `variantKind`, `decisionState` (`NONE`/`CURRENT`/`STALE`),
  `effectiveDecision`, `blocks` and a human-readable `reason`.
- `templateTextDecisionRecordSchema` - `{ decision, decidedBy, decidedAt, textAtDecision }`.

Schema changes, all backward-readable with no migration:

- `placeholderSchema.originalText` (optional, nullable), plus
  `originalTextTruncated`, `originalTextPreview` and `originalTextVerification`
  on the manifest. An absent `originalText` WITH verification metadata means
  "too long to store, still fully verifiable"; absent with no metadata keeps
  its own meaning, "never captured".
- `placeholderMappingSchema.keepTemplateText` - optional and nullable; absent
  and null both mean "no decision recorded", and there is deliberately no
  default, because any default would be a decision nobody made.
- `templateTextDecisionRecordSchema.textDigestAtDecision` (optional) binds a
  decision to the complete mapped text's digest; records without it fall back
  to `textAtDecision`.
- Two new plan edit operations: `SET_TEMPLATE_TEXT_DECISION` (with `decision`)
  and `CLEAR_TEMPLATE_TEXT_DECISION`. `updateExecutionPlan` takes the editing
  user so the decision is attributable; it refuses rather than record an
  unattributable one.

## text-digest (canonical text verification)

`packages/schemas/src/text-digest.ts` - pure TypeScript, no platform API, so
the worker, the API and the browser all compute byte-identical results
(pinned in tests against `node:crypto` and `TextEncoder`):

- `sha256Hex(text)` and `utf16leBytes(text)` - SHA-256 over the string's own
  UTF-16 code units, little endian, no BOM (`sha256-utf16le-code-units-v1`).
  Injective over every JavaScript string, including unpaired surrogates.
- `Sha256Stream` and `TextVerificationStream` - incremental, so a text far too
  large to hold can still be verified exactly, one bounded slice at a time.
- `stripWhitespace` (explicit code-point set) and `foldCase` (per code point,
  locale-independent) - the ONLY normalizations, shared with the gate itself,
  and both context-free so they stream safely.
- `TEXT_CAPTURE_STATUSES` (`COMPLETE`, `VERIFIED_EXCERPT`, `CAPTURE_FAILED`,
  `TOO_LARGE`) and `MAX_VERIFIABLE_TEXT_CODE_UNITS`.
- `computeTextVerification(completeText) -> TextVerification`:
  `{ algorithm, codeUnitLength, fullDigest, caseFoldedDigest,
  whitespaceStrippedDigest, caseFoldedWhitespaceStrippedDigest }`.
- `compareByVerification(candidate, reference)` - identical / case-only /
  whitespace-only / both, mirroring the full-text comparison exactly.

`algorithm` is stored with every record as a plain string, so a record written
under an older algorithm still PARSES but is never compared - the gate reports
it as uncheckable and names re-inspection as the fix.

The manifest also carries `originalTextCaptureStatus` and
`originalTextCodeUnitLength`, so the gate can distinguish a transient capture
failure (re-inspectable) from a text beyond the verifiable size (terminal).

## disposable-inspection (safe-inspection evidence)

`packages/schemas/src/disposable-inspection.ts`:

- `disposableInspectionEvidenceSchema` - the auditable record every safe
  inspection reports: operation, target path and expected/actual hash, the
  disposable copy's path and hash, source and working-copy hashes before and
  after, `priorAeProjectState`, `restoration`, `cleanup`, their notes,
  `unresolvedFootage`, and timestamps.
- `DISPOSABLE_INSPECTION_FAILURE_CODES` - `BUSY`, `TARGET_HASH_MISMATCH`,
  `TARGET_DIRECTORY_NOT_WRITABLE`, `COPY_FAILED`, `AE_STATE_UNKNOWN`,
  `AE_PROJECT_NOT_SAFE_TO_REPLACE`, `OPEN_FAILED`, `FOOTAGE_UNRESOLVED`,
  `INSPECTION_FAILED`, `PROTECTED_FILE_CHANGED`.
- `RESTORATION_OUTCOMES` - `NOTHING_TO_RESTORE`, `RESTORED`, `RESTORE_FAILED`,
  `NOT_DISTURBED`.
- `CLEANUP_OUTCOMES` - `DELETED`, `NOTHING_TO_CLEAN`, `QUARANTINED`,
  `CLEANUP_FAILED`, `LEFT_IN_PLACE_STILL_OPEN`.

Carried as an OPTIONAL `safeInspection` field on
`rawInspectionCaptureSchema`, `manifestInspectionResultSchema`,
`sceneEvidenceResponseSchema` and `inspectRenderCapabilitiesResponseSchema`, so
results written before Stage 3 still parse.

`inspectRenderCapabilitiesRequestSchema` gains optional `sourceProjectPath` and
`sourceProjectSha256`, and the dispatch request gains an optional `projectId`;
the API resolves the real path and sha256 from its own project record, so the
browser never supplies a path.

## slot-semantics / slot-readiness (Stage 4)

`packages/schemas/src/slot-semantics.ts` - what a slot IS, whether an asset
belongs in it, and whether the fit will render correctly:

- `SLOT_SEMANTICS_MODEL_VERSION`, `SLOT_FINGERPRINT_VERSION`,
  `SLOT_CONFIDENCE_THRESHOLD` - a stored verdict produced by another model
  version is never reinterpreted, it is reported as uncheckable.
- `MATTE_SOURCES` - `RENDERED_FOOTAGE` / `DRAWN_MASK_OR_SOLID` / `NONE` /
  `UNKNOWN`. Matte PRESENCE proves nothing; what the matte is MADE OF is the
  strongest single signal.
- `slotHostFactsSchema` / `slotStructuralFactsSchema` - one slot's structure:
  hosts, host depth, reuse count, 3D state, parent animation, sibling
  pre-rendered pass, dimensions, transformed bounds and `visibleWindowSeconds`.
  `slotLayerName`/`slotCompositionName` are carried for display and weak
  evidence only.
- `classifySlotSemantics(facts)` -> `{ classification, confidence, conflicting,
  positiveEvidence, negativeEvidence, requiresHumanDecision, reason }`. Name
  evidence is collected but never added to the decision sums.
- `computeSlotFingerprint` / `slotFingerprintsMatch` /
  `computeSlotMutationFingerprint` - names excluded; a rename is not a
  structural change and must not fail an approved plan.
- `assessAssetSlotCompatibility(slot, asset)` - `AssetFacts` has NO filename
  field. Blocking codes: `LOGO_INTO_DEVICE_SCREEN`,
  `TRANSPARENT_ASSET_INTO_DEVICE_SCREEN`, `SCREENSHOT_INTO_FLAT_CARD`,
  `SEVERE_ASPECT_MISMATCH`, `ROLE_UNDECLARED`, `ASSET_DIMENSIONS_UNKNOWN`.
- `assessFit({ slot, asset, mode })` - scale per axis, slot coverage, cropped
  percent, unused area, distortion, and the flags `EXCESSIVE_CROP`,
  `LARGE_UNUSED_AREA`, `DISTORTED`, `DIMENSIONS_UNKNOWN`.
- `selectEvidenceFrameSeconds(facts)` - the midpoint of the visible window, or
  null when the slot never presents a provable visible moment.
- `slotReviewRecordSchema` - `{ decision, classification, decidedBy, decidedAt,
  evidenceDigest, evidenceFrameStorageKey }`.

`packages/schemas/src/slot-readiness.ts` - the gate both the API and the
dashboard run, so they can never disagree: `SLOT_BLOCKER_KINDS`
(`SLOT_SEMANTICS_MISSING`, `SLOT_SEMANTICS_STALE_MODEL`,
`SLOT_CLASSIFICATION_UNCERTAIN`, `ASSET_SLOT_CONFLICT`, `UNSAFE_FIT`),
`assessMappingSlot`, `findSlotBlockers`, `slotEvidenceDigest`, `fitModeForRole`
and `describeSlotBlockers`. Each blocker carries `requiresEvidenceFrame`,
`evidenceFrameAtSeconds` and `evidenceFrameWindowSeconds`.

Manifest and plan carry these as OPTIONAL fields - `slotFacts`,
`slotSemantics`, `slotFingerprint`, `slotMutationFingerprint` on a placeholder,
`slotReview` on a mapping - so everything written before Stage 4 still parses.
A manifest with no slot facts for a visual slot blocks and names re-inspection
as the fix.

`assetDtoSchema` gains optional `hasAlpha` (measured from the uploaded bytes;
null = never measured), and `sceneEvidencePreviewDtoSchema` gains optional
`capturedAtSeconds` and `storageKey` - the two facts that make a captured frame
usable as evidence for a specific slot.
