"use client";

import { useMemo, useState, type ReactElement } from "react";
import type { ExecutionPlanEditOperation, ScenePlanEntry, TemplateManifest } from "@dyo/schemas";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

/**
 * REAL 2026-10-06, asked for by the client while making his first video: "one
 * time I will set the header, a subtitle, a text ... one time to set the
 * colour, and it will keep on appearing already selected - that way it will be
 * much faster." The same colour layer repeats in every scene of a template,
 * and the only place to set it was each scene's own drawer, one at a time.
 *
 * This card lists each DISTINCT colour layer once, by the layer's own name,
 * with how many places it appears in, and writes one choice to all of them.
 * It invents nothing: the groups are the plan's own colour mappings (the same
 * ones each drawer offers, under the same rule for which can be set), and a
 * save is the same SET_BRAND_COLOR / CLEAR_BRAND_COLOR each drawer sends.
 */
export interface ColourGroup {
  /** The layer's own name in the template - what repeats from scene to scene. */
  name: string;
  targets: Array<{ scenePlanId: string; mappingId: string }>;
  /** The template's colour when every place agrees on one, else null. */
  templateColorHex: string | null;
  /** The colour already chosen when every place holds the same one; "" when none is chosen; null when the places differ. */
  chosenColorHex: string | null;
}

export function collectColourGroups(scenePlans: readonly ScenePlanEntry[], manifest: TemplateManifest): ColourGroup[] {
  const placeholders = new Map<string, TemplateManifest["scenes"][number]["placeholders"][number]>();
  for (const scene of manifest.scenes) {
    for (const placeholder of scene.placeholders) {
      placeholders.set(placeholder.placeholderId, placeholder);
    }
  }
  const groups = new Map<string, { targets: ColourGroup["targets"]; templateColours: Set<string | null>; chosen: Set<string> }>();
  for (const scene of scenePlans) {
    for (const mapping of scene.mappings) {
      if (mapping.placeholderClassification.value !== "color" || mapping.manifestPlaceholderId === null) {
        continue;
      }
      const placeholder = placeholders.get(mapping.manifestPlaceholderId);
      if (!placeholder) {
        continue;
      }
      // The drawer's own rule: a nested colour can only be set through a Color Control.
      const colorControl = placeholder.colorControl ?? null;
      if (colorControl === null && (placeholder.layerPath ?? []).length > 0) {
        continue;
      }
      const name = mapping.placeholderName ?? placeholder.layerName;
      const group = groups.get(name) ?? { targets: [], templateColours: new Set<string | null>(), chosen: new Set<string>() };
      group.targets.push({ scenePlanId: scene.id, mappingId: mapping.id });
      group.templateColours.add(colorControl?.currentColorHex ?? null);
      group.chosen.add(mapping.colorHex ?? "");
      groups.set(name, group);
    }
  }
  return [...groups.entries()].map(([name, group]) => ({
    name,
    targets: group.targets,
    templateColorHex: group.templateColours.size === 1 ? ([...group.templateColours][0] ?? null) : null,
    chosenColorHex: group.chosen.size === 1 ? ([...group.chosen][0] as string) : null
  }));
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function WholeVideoColours({
  scenePlans,
  manifest,
  disabled,
  applyEdit
}: {
  scenePlans: readonly ScenePlanEntry[];
  manifest: TemplateManifest;
  disabled: boolean;
  applyEdit: (operations: ExecutionPlanEditOperation[]) => Promise<{ ok: boolean; message?: string | null }>;
}): ReactElement | null {
  const { t } = useLocale();
  const groups = useMemo(() => collectColourGroups(scenePlans, manifest), [scenePlans, manifest]);
  // Only what the person changed here: name -> "#RRGGBB", or "" for "back to the template's colour".
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // One place is what the scene's own drawer is for; this card earns its room only when a colour repeats.
  if (!groups.some((group) => group.targets.length > 1)) {
    return null;
  }

  const changed = groups.filter((group) => {
    const value = draft[group.name];
    return value !== undefined && (value === "" || HEX.test(value)) && value.toUpperCase() !== (group.chosenColorHex ?? "\u0000").toUpperCase();
  });

  async function handleApply(): Promise<void> {
    const operations: ExecutionPlanEditOperation[] = changed.flatMap((group) =>
      group.targets.map((target) =>
        draft[group.name] === ""
          ? { type: "CLEAR_BRAND_COLOR" as const, scenePlanId: target.scenePlanId, mappingId: target.mappingId }
          : { type: "SET_BRAND_COLOR" as const, scenePlanId: target.scenePlanId, mappingId: target.mappingId, colorHex: draft[group.name] as string }
      )
    );
    if (operations.length === 0) {
      return;
    }
    setIsSaving(true);
    setError(null);
    setSavedCount(null);
    const result = await applyEdit(operations);
    setIsSaving(false);
    if (result.ok) {
      setSavedCount(operations.length);
      setDraft({});
    } else {
      setError(result.message ?? t.projectWorkspace.saveFailedTitle);
    }
  }

  return (
    <Card className="whole-video-colours">
      <details>
        <summary>{t.simpleScenes.wholeVideoColours.summary(groups.length)}</summary>
        <p className="field__hint">{t.simpleScenes.wholeVideoColours.hint}</p>
        {error ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={error} /> : null}
        <ul className="whole-video-colours__list">
          {groups.map((group) => {
            const value = draft[group.name] ?? group.chosenColorHex ?? "";
            const shown = HEX.test(value) ? value : (group.templateColorHex ?? "#000000");
            const inputId = `whole-video-colour-${group.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
            return (
              <li key={group.name} className="whole-video-colours__row">
                <label htmlFor={inputId} className="whole-video-colours__name">
                  {group.name}
                  <span className="field__hint"> {t.simpleScenes.wholeVideoColours.places(group.targets.length)}</span>
                </label>
                <input
                  id={inputId}
                  type="color"
                  className="edit-drawer-color__swatch"
                  disabled={disabled || isSaving}
                  /* A native colour input cannot show "nothing chosen"; it shows the template's colour, and only a real change writes one. */
                  value={shown}
                  onChange={(event) => setDraft((current) => ({ ...current, [group.name]: event.target.value.toUpperCase() }))}
                />
                <span className="whole-video-colours__state">
                  {draft[group.name] === ""
                    ? t.simpleScenes.wholeVideoColours.backToTemplate
                    : HEX.test(value)
                      ? value.toUpperCase()
                      : group.chosenColorHex === null
                        ? t.simpleScenes.wholeVideoColours.mixed
                        : t.simpleScenes.wholeVideoColours.templateColour}
                </span>
                {value === "" && group.chosenColorHex !== null ? null : (
                  <Button size="sm" variant="ghost" disabled={disabled || isSaving} onClick={() => setDraft((current) => ({ ...current, [group.name]: "" }))}>
                    {t.projectWorkspace.editDrawer.colorClearAction}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="overview-actions">
          <Button variant="primary" disabled={disabled || isSaving || changed.length === 0} onClick={() => void handleApply()}>
            {isSaving ? t.projectWorkspace.savingLabel : t.simpleScenes.wholeVideoColours.applyAction}
          </Button>
          {savedCount !== null ? <span role="status">{t.simpleScenes.wholeVideoColours.saved(savedCount)}</span> : null}
        </div>
      </details>
    </Card>
  );
}
