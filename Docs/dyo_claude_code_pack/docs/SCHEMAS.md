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
