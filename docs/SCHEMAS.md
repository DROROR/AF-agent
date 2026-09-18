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

- `placeholderSchema.originalText` (optional, nullable) and
  `originalTextTruncated` (optional) on the manifest - an absent key keeps its
  own meaning, "never captured".
- `placeholderMappingSchema.keepTemplateText` - optional and nullable; absent
  and null both mean "no decision recorded", and there is deliberately no
  default, because any default would be a decision nobody made.
- Two new plan edit operations: `SET_TEMPLATE_TEXT_DECISION` (with `decision`)
  and `CLEAR_TEMPLATE_TEXT_DECISION`. `updateExecutionPlan` takes the editing
  user so the decision is attributable; it refuses rather than record an
  unattributable one.
