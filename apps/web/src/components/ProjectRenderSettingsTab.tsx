"use client";

import { useState, type ReactElement } from "react";
import { RENDER_OUTPUT_VARIANTS, type Composition, type RenderOutputConfig, type RenderOutputVariant } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";

/**
 * Real Output Config UI (render-delivery phase section 2) - the composition
 * picker is sourced ONLY from `project.manifest.compositions` (the same
 * already-loaded manifest ProjectOverviewTab/ProjectScenesTab read), never
 * an arbitrary numeric index field. Saving goes through
 * useProjectWorkspaceContext().setRenderOutput, which calls the real
 * PUT .../render-outputs/:variant endpoint - the server re-resolves
 * aeProjectItemIndex/compositionName itself from manifestCompositionId
 * (see set-render-output-config.ts); nothing here ever sends those two
 * fields directly.
 */
export function ProjectRenderSettingsTab(): ReactElement | null {
  const { project, plan } = useProjectWorkspaceContext();

  if (!project) {
    return null;
  }

  const compositions = project.manifest.compositions;

  return (
    <div className="overview-grid">
      {RENDER_OUTPUT_VARIANTS.map((variant) => (
        <VariantConfigCard
          key={variant}
          variant={variant}
          compositions={compositions}
          currentConfig={plan?.plan.renderOutputs[variant] ?? null}
          currentSourceSha={project.manifest.sourceProject.sha256}
        />
      ))}
    </div>
  );
}

function VariantConfigCard({
  variant,
  compositions,
  currentConfig,
  currentSourceSha
}: {
  variant: RenderOutputVariant;
  compositions: Composition[];
  currentConfig: RenderOutputConfig | null;
  currentSourceSha: string;
}): ReactElement {
  const { t } = useLocale();
  const { setRenderOutput } = useProjectWorkspaceContext();
  const [manifestCompositionId, setManifestCompositionId] = useState(currentConfig?.manifestCompositionId ?? "");
  const [renderSettingsTemplateName, setRenderSettingsTemplateName] = useState(currentConfig?.renderSettingsTemplateName ?? "");
  const [outputModuleTemplateName, setOutputModuleTemplateName] = useState(currentConfig?.outputModuleTemplateName ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isStale = currentConfig !== null && currentConfig.sourceProjectSha256 !== currentSourceSha;
  const selectedComposition = compositions.find((c) => c.compositionId === manifestCompositionId) ?? null;
  const canSave = manifestCompositionId !== "" && renderSettingsTemplateName.trim() !== "" && outputModuleTemplateName.trim() !== "";

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    const result = await setRenderOutput(variant, {
      manifestCompositionId,
      renderSettingsTemplateName: renderSettingsTemplateName.trim(),
      outputModuleTemplateName: outputModuleTemplateName.trim()
    });
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.message ?? null);
    }
  }

  return (
    <Card className="overview-section">
      <CardHeader title={t.projectWorkspace.renderSettings.variantSection[variant]} />

      {compositions.length === 0 ? (
        <EmptyState
          title={t.projectWorkspace.renderSettings.noCompositionsTitle}
          description={t.projectWorkspace.renderSettings.noCompositionsDescription}
        />
      ) : (
        <>
          {isStale ? (
            <ErrorState
              title={t.projectWorkspace.renderSettings.staleWarningTitle}
              description={t.projectWorkspace.renderSettings.staleWarningDescription}
            />
          ) : null}

          <Field label={t.projectWorkspace.renderSettings.compositionLabel} htmlFor={`render-composition-${variant}`}>
            <Select
              id={`render-composition-${variant}`}
              value={manifestCompositionId}
              disabled={isSaving}
              onChange={(event) => setManifestCompositionId(event.target.value)}
            >
              <option value="">{t.projectWorkspace.renderSettings.compositionPlaceholder}</option>
              {compositions.map((composition) => (
                <option key={composition.compositionId} value={composition.compositionId}>
                  {composition.name} ({composition.widthPx}×{composition.heightPx})
                </option>
              ))}
            </Select>
          </Field>

          {selectedComposition ? (
            <dl className="overview-fact-list">
              <div>
                <dt>{t.projectWorkspace.renderSettings.compositionLabel}</dt>
                <dd>{selectedComposition.name}</dd>
              </div>
              <div>
                <dt>{t.projectWorkspace.renderSettings.compositionIdentityLabel}</dt>
                <dd>
                  <code>{selectedComposition.compositionId}</code>
                </dd>
              </div>
              <div>
                <dt>{t.projectWorkspace.renderSettings.dimensionsLabel}</dt>
                <dd>
                  {selectedComposition.widthPx}×{selectedComposition.heightPx}
                </dd>
              </div>
            </dl>
          ) : null}

          <Field
            label={t.projectWorkspace.renderSettings.renderSettingsTemplateLabel}
            htmlFor={`render-rs-template-${variant}`}
            hint={t.projectWorkspace.renderSettings.templateHint}
          >
            <Input
              id={`render-rs-template-${variant}`}
              value={renderSettingsTemplateName}
              disabled={isSaving}
              onChange={(event) => setRenderSettingsTemplateName(event.target.value)}
            />
          </Field>

          <Field label={t.projectWorkspace.renderSettings.outputModuleTemplateLabel} htmlFor={`render-om-template-${variant}`}>
            <Input
              id={`render-om-template-${variant}`}
              value={outputModuleTemplateName}
              disabled={isSaving}
              onChange={(event) => setOutputModuleTemplateName(event.target.value)}
            />
          </Field>

          {saveError ? <ErrorState title={t.projectWorkspace.renderSettings.saveFailedTitle} description={saveError} /> : null}

          {currentConfig && !isStale ? (
            <p className="overview-section__ready-title">
              {t.projectWorkspace.renderSettings.savedConfiguredAt(new Date(currentConfig.configuredAt).toLocaleString())}
            </p>
          ) : null}

          <div className="overview-actions">
            <Button variant="primary" disabled={!canSave || isSaving} onClick={() => void handleSave()}>
              {isSaving ? t.projectWorkspace.renderSettings.savingLabel : t.projectWorkspace.renderSettings.saveAction}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
