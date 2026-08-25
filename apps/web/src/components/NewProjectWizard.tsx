"use client";

import { useState, type ReactElement } from "react";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { useLocale } from "./LocaleProvider";
import { PendingPanel } from "./ui/PendingPanel";
import { SceneTable } from "./SceneTable";
import type { Dictionary } from "../lib/i18n/dictionaries";

type StepId = keyof Dictionary["projectsNew"]["steps"];

const STEP_IDS: readonly StepId[] = [
  "details",
  "template",
  "work-map",
  "assets",
  "inspection",
  "scenes",
  "review",
  "render"
];

/**
 * UI structure only, per CLAUDE.md's Required Workflow steps 1-19 - no
 * submission handler exists because no project-intake API exists yet.
 * Every field here is local component state; nothing is sent anywhere.
 */
export function NewProjectWizard(): ReactElement {
  const { t } = useLocale();
  const [stepIndex, setStepIndex] = useState(0);
  // stepIndex is always kept within [0, STEP_IDS.length - 1] by the Back/Next
  // handlers below (Math.max(0, ...) / Math.min(STEP_IDS.length - 1, ...)),
  // so this index access is always in-bounds - STEP_IDS is a fixed,
  // non-empty constant, not data that could ever be shorter than expected.
  const stepId = STEP_IDS[stepIndex] as StepId;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEP_IDS.length - 1;

  return (
    <>
      <PageHeader title={t.projectsNew.title} description={t.projectsNew.description} />

      <div className="stepper" role="tablist" aria-label={t.projectsNew.stepperLabel}>
        {STEP_IDS.map((id, i) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={i === stepIndex}
            className="stepper__step"
            data-active={i === stepIndex}
            data-complete={i < stepIndex}
            onClick={() => setStepIndex(i)}
          >
            <span className="stepper__index">
              <span>{i + 1}</span>
            </span>
            {t.projectsNew.steps[id]}
          </button>
        ))}
      </div>

      <Card>
        <StepContent stepId={stepId} />
      </Card>

      <div className="page-header__actions">
        <Button variant="secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={isFirst}>
          {t.common.back}
        </Button>
        {!isLast ? (
          <Button variant="primary" onClick={() => setStepIndex((i) => Math.min(STEP_IDS.length - 1, i + 1))}>
            {t.common.next}
          </Button>
        ) : (
          <Button variant="primary" disabled title={t.projectsNew.submitDisabledTitle}>
            {t.projectsNew.submitForApproval}
          </Button>
        )}
      </div>
    </>
  );
}

function StepContent({ stepId }: { stepId: StepId }): ReactElement {
  const { t } = useLocale();

  switch (stepId) {
    case "details":
      return (
        <div className="card-grid">
          <Field label={t.projectsNew.fields.projectName} htmlFor="project-name">
            <Input id="project-name" name="project-name" placeholder={t.projectsNew.fields.projectNamePlaceholder} disabled />
          </Field>
          <Field label={t.projectsNew.fields.client} htmlFor="project-client">
            <Input id="project-client" name="project-client" placeholder={t.projectsNew.fields.clientPlaceholder} disabled />
          </Field>
          <Field label={t.projectsNew.fields.orientation} htmlFor="project-orientation" hint={t.projectsNew.fields.orientationHint}>
            <Select id="project-orientation" name="project-orientation" disabled defaultValue="both">
              <option value="both">{t.projectsNew.fields.orientationBoth}</option>
              <option value="landscape">{t.projectsNew.fields.orientationLandscape}</option>
              <option value="reels">{t.projectsNew.fields.orientationReels}</option>
            </Select>
          </Field>
        </div>
      );
    case "template":
      return <PendingPanel title={t.projectsNew.template.title} description={t.projectsNew.template.description} />;
    case "work-map":
      return <PendingPanel title={t.projectsNew.workMap.title} description={t.projectsNew.workMap.description} />;
    case "assets":
      return <PendingPanel title={t.projectsNew.assets.title} description={t.projectsNew.assets.description} />;
    case "inspection":
      return <PendingPanel title={t.projectsNew.inspection.title} description={t.projectsNew.inspection.description} />;
    case "scenes":
      return <SceneTable rows={[]} />;
    case "review":
      return <PendingPanel title={t.projectsNew.review.title} description={t.projectsNew.review.description} />;
    case "render":
      return <PendingPanel title={t.projectsNew.render.title} description={t.projectsNew.render.description} />;
    default:
      return <PendingPanel title={t.projectsNew.stepNotAvailableTitle} description={t.projectsNew.stepNotAvailableDescription} />;
  }
}
