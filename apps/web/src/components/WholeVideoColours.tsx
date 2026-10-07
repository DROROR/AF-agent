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
  /**
   * When this colour is on screen, from the template reading (2026-10-07): a
   * client set "BLACK" to white and saw nothing change - that layer is a
   * 1.5-second fade at the very end, not the background. Null when the
   * places differ or the reading has no timing.
   */
  shownFromSeconds: number | null;
  shownForSeconds: number | null;
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
  const groups = new Map<string, { targets: ColourGroup["targets"]; templateColours: Set<string | null>; chosen: Set<string>; timings: Set<string> }>();
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
      const group = groups.get(name) ?? { targets: [], templateColours: new Set<string | null>(), chosen: new Set<string>(), timings: new Set<string>() };
      group.targets.push({ scenePlanId: scene.id, mappingId: mapping.id });
      group.timings.add(typeof placeholder.startTimeSeconds === "number" && typeof placeholder.durationSeconds === "number" ? `${placeholder.startTimeSeconds}|${placeholder.durationSeconds}` : "?");
      group.templateColours.add(colorControl?.currentColorHex ?? null);
      group.chosen.add(mapping.colorHex ?? "");
      groups.set(name, group);
    }
  }
  return [...groups.entries()].map(([name, group]) => {
    const timing = group.timings.size === 1 && ![...group.timings].includes("?") ? ([...group.timings][0] as string).split("|").map(Number) : null;
    return {
      name,
      targets: group.targets,
      templateColorHex: group.templateColours.size === 1 ? ([...group.templateColours][0] ?? null) : null,
      chosenColorHex: group.chosen.size === 1 ? ([...group.chosen][0] as string) : null,
      shownFromSeconds: timing === null ? null : (timing[0] as number),
      shownForSeconds: timing === null ? null : (timing[1] as number)
    };
  });
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

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

  // The video's length, for telling a colour shown throughout from one shown for a moment.
  const videoSeconds = Math.max(0, ...manifest.compositions.filter((composition) => !composition.isNestedOnlyReferenced).map((composition) => composition.durationSeconds));
  return (
    <Card className="whole-video-colours">
        <h3 className="whole-video-colours__title">{t.simpleScenes.wholeVideoColours.title}</h3>
        <p className="whole-video-colours__hint">{t.simpleScenes.wholeVideoColours.hint}</p>
        {error ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={error} /> : null}
        <ul className="whole-video-colours__list">
          {groups.map((group) => {
            const value = draft[group.name] ?? group.chosenColorHex ?? "";
            const shown = HEX.test(value) ? value : (group.templateColorHex ?? "#000000");
            const inputId = `whole-video-colour-${group.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
            return (
              <li key={group.name} className="whole-video-colours__row" data-changed={draft[group.name] !== undefined}>
                <input
                  id={inputId}
                  type="color"
                  className="edit-drawer-color__swatch"
                  disabled={disabled || isSaving}
                  /* A native colour input cannot show "nothing chosen"; it shows the template's colour, and only a real change writes one. */
                  value={shown}
                  onChange={(event) => setDraft((current) => ({ ...current, [group.name]: event.target.value.toUpperCase() }))}
                />
                <label htmlFor={inputId} className="whole-video-colours__name">
                  {/* The name can carry the path of the control it sits under; the last part is the layer itself. */}
                  <span title={group.name}>{group.name.split("›").pop()?.trim() ?? group.name}</span>
                  <span className="whole-video-colours__places">{t.simpleScenes.wholeVideoColours.places(group.targets.length)}</span>
                  {/* A colour on screen for only part of the video says when - so a 1.5-second fade is never taken for the background. */}
                  {group.shownFromSeconds !== null && group.shownForSeconds !== null && group.shownForSeconds < videoSeconds * 0.9 ? (
                    <span className="whole-video-colours__places">{t.simpleScenes.wholeVideoColours.shownAt(formatClock(group.shownFromSeconds), group.shownForSeconds)}</span>
                  ) : null}
                </label>
                {/* 2026-10-07: a line under every swatch ("Template's colour", a hex code) was eight lines of nothing to decide; said only where a colour was chosen or differs. */}
                {draft[group.name] === "" ? (
                  <span className="whole-video-colours__state">{t.simpleScenes.wholeVideoColours.backToTemplate}</span>
                ) : HEX.test(value) ? (
                  <span className="whole-video-colours__state">{t.simpleScenes.wholeVideoColours.chosen}</span>
                ) : group.chosenColorHex === null ? (
                  <span className="whole-video-colours__state">{t.simpleScenes.wholeVideoColours.mixed}</span>
                ) : null}
                {/* A way back wherever a colour is chosen, or the places differ - never under a swatch still on the template's colour. */}
                {(draft[group.name] !== undefined ? draft[group.name] !== "" : group.chosenColorHex !== "") ? (
                  <Button size="sm" variant="ghost" disabled={disabled || isSaving} onClick={() => setDraft((current) => ({ ...current, [group.name]: "" }))}>
                    {t.simpleScenes.wholeVideoColours.reset}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="overview-actions">
          <Button variant="primary" disabled={disabled || isSaving || changed.length === 0} disabledReason={changed.length === 0 ? t.simpleScenes.wholeVideoColours.nothingChangedReason : undefined} onClick={() => void handleApply()}>
            {isSaving ? t.projectWorkspace.savingLabel : t.simpleScenes.wholeVideoColours.applyAction}
          </Button>
          {savedCount !== null ? <span role="status">{t.simpleScenes.wholeVideoColours.saved(savedCount)}</span> : null}
        </div>
    </Card>
  );
}
