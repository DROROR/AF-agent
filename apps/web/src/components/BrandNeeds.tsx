"use client";

import { useState, type ReactElement } from "react";
import type { AssetDto, BrandNeed, ExecutionPlanEditOperation, ScenePlanEntry } from "@dyo/schemas";
import { assetFileUrl } from "../lib/projects-api-client";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Select } from "./ui/Select";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

/**
 * REAL 2026-10-07 (client project 3241977f): every step of the Scenes guide
 * was ticked, "Approve Scenes" was pressed, and both permanent brand rules
 * came back at once as one red paragraph - no logo, no "by DYO App" line. His
 * logo WAS in the video; the file had been uploaded in the picture box, and
 * only a file placed as a logo counts.
 *
 * This card says what is missing before approval is tried, one thing at a
 * time, each with the control that settles it:
 *  - the logo: the pictures already placed in the video are listed, and the
 *    client says which one is the logo. That is recorded as the same
 *    MAP_ASSET a drawer sends, with the picture's kind stated as "logo" - a
 *    person's own statement about their own file, never inferred.
 *  - the line: the client picks one of the texts already written and the
 *    exact configured line (handed over by the server, never typed here) is
 *    added to it with the ordinary SET_TEXT.
 * Whether the rules are met is still decided by the server alone.
 */
export interface BrandNeedsProps {
  projectId: string;
  needs: readonly BrandNeed[];
  scenePlans: readonly ScenePlanEntry[];
  assets: readonly AssetDto[] | null;
  disabled: boolean;
  applyEdit: (operations: ExecutionPlanEditOperation[]) => Promise<{ ok: boolean; message?: string }>;
}

export function BrandNeeds({ projectId, needs, scenePlans, assets, disabled, applyEdit }: BrandNeedsProps): ReactElement | null {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textTarget, setTextTarget] = useState("");

  if (needs.length === 0) {
    return null;
  }

  const active = scenePlans.filter((scene) => scene.use);
  const placedPictures = (assets ?? []).filter(
    (asset) => asset.mediaKind === "IMAGE" && active.some((scene) => scene.mappings.some((mapping) => mapping.selectedAssetId === asset.id))
  );
  const unplacedLogos = (assets ?? []).filter(
    (asset) => asset.mediaKind === "LOGO" && !active.some((scene) => scene.mappings.some((mapping) => mapping.selectedAssetId === asset.id))
  );
  const writtenTexts = active.flatMap((scene) =>
    scene.mappings.filter((mapping) => mapping.text !== null && mapping.text.trim() !== "").map((mapping) => ({ scenePlanId: scene.id, mappingId: mapping.id, text: mapping.text as string }))
  );

  async function send(operations: ExecutionPlanEditOperation[]): Promise<void> {
    if (operations.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await applyEdit(operations);
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? null);
    }
  }

  const nameOf = (asset: AssetDto): string => (asset.label !== null && asset.label.trim() !== "" ? asset.label : asset.originalFilename);

  return (
    <Card className="brand-needs">
      <h2 className="brand-needs__title">{t.simpleScenes.brandNeeds.title}</h2>
      <p className="brand-needs__intro">{t.simpleScenes.brandNeeds.intro(needs.length)}</p>
      {error ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={error} /> : null}
      {needs.map((need) => {
        if (need.rule === "LOGO_PRESENCE") {
          return (
            <section key={need.rule} className="brand-needs__item">
              <h3>{t.simpleScenes.brandNeeds.logoTitle}</h3>
              {placedPictures.length > 0 ? (
                <>
                  <p>{t.simpleScenes.brandNeeds.logoPickHint}</p>
                  <div className="brand-needs__choices">
                    {placedPictures.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className="brand-needs__choice"
                        disabled={disabled || busy}
                        onClick={() =>
                          void send(
                            active.flatMap((scene) =>
                              scene.mappings
                                .filter((mapping) => mapping.selectedAssetId === asset.id)
                                .map((mapping) => ({ type: "MAP_ASSET" as const, scenePlanId: scene.id, mappingId: mapping.id, selectedAssetId: asset.id, selectedAssetType: "logo" as const }))
                            )
                          )
                        }
                      >
                        <img src={assetFileUrl(projectId, asset.id)} alt="" />
                        <span dir="auto">{nameOf(asset)}</span>
                        <span className="brand-needs__choice-action">{t.simpleScenes.brandNeeds.logoPickAction}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <p className="brand-needs__aside">
                {unplacedLogos.length > 0 ? t.simpleScenes.brandNeeds.logoUnplacedHint(unplacedLogos.map(nameOf).join(", ")) : t.simpleScenes.brandNeeds.logoUploadHint}
              </p>
            </section>
          );
        }
        if (need.rule === "REQUIRED_HEBREW_TEXT" && need.requiredText !== null) {
          const line = need.requiredText;
          const target = writtenTexts.find((entry) => entry.mappingId === textTarget) ?? null;
          return (
            <section key={need.rule} className="brand-needs__item">
              <h3>{t.simpleScenes.brandNeeds.lineTitle}</h3>
              <p>
                {t.simpleScenes.brandNeeds.lineHint} <strong className="brand-needs__line" dir="auto">{line}</strong>
              </p>
              {writtenTexts.length > 0 ? (
                <div className="brand-needs__row">
                  <Select aria-label={t.simpleScenes.brandNeeds.linePickLabel} value={textTarget} disabled={disabled || busy} onChange={(event) => setTextTarget(event.target.value)}>
                    <option value="">{t.simpleScenes.brandNeeds.linePickLabel}</option>
                    {writtenTexts.map((entry) => (
                      <option key={entry.mappingId} value={entry.mappingId}>
                        {entry.text}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={disabled || busy || target === null}
                    onClick={() => (target === null ? undefined : void send([{ type: "SET_TEXT", scenePlanId: target.scenePlanId, mappingId: target.mappingId, text: `${target.text} ${line}` }]))}
                  >
                    {t.simpleScenes.brandNeeds.lineAddAction}
                  </Button>
                </div>
              ) : null}
              <p className="brand-needs__aside">{t.simpleScenes.brandNeeds.lineAside}</p>
            </section>
          );
        }
        return (
          <section key={need.rule} className="brand-needs__item">
            <p>{need.message}</p>
          </section>
        );
      })}
    </Card>
  );
}
