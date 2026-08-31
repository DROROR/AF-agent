import { describe, expect, it } from "vitest";
import { computeWorkflowSteps, currentStepIndex, type WorkflowStepInput } from "./project-workflow-steps";

function input(overrides: Partial<WorkflowStepInput> = {}): WorkflowStepInput {
  return {
    hasProject: true,
    workMapEntryCount: 0,
    hasPlan: false,
    planApproved: false,
    firstPreviewApproved: false,
    allScenesComplete: false,
    hasRenderArtifact: false,
    ...overrides
  };
}

function stateOf(steps: ReturnType<typeof computeWorkflowSteps>, id: string): string {
  return steps.find((s) => s.id === id)!.state;
}

describe("computeWorkflowSteps", () => {
  it("upload is always complete once a project exists - the page itself proves this", () => {
    const steps = computeWorkflowSteps(input());
    expect(stateOf(steps, "upload")).toBe("complete");
  });

  it("tellClaude is current (never complete) with zero Work Map entries, and every later step is locked", () => {
    const steps = computeWorkflowSteps(input());
    expect(stateOf(steps, "tellClaude")).toBe("current");
    expect(stateOf(steps, "reviewPlan")).toBe("locked");
    expect(stateOf(steps, "sceneMappings")).toBe("locked");
    expect(stateOf(steps, "firstPreview")).toBe("locked");
    expect(stateOf(steps, "finalPreview")).toBe("locked");
    expect(stateOf(steps, "render")).toBe("locked");
  });

  it("tellClaude completes once the Work Map has a real entry, unlocking reviewPlan as current", () => {
    const steps = computeWorkflowSteps(input({ workMapEntryCount: 1 }));
    expect(stateOf(steps, "tellClaude")).toBe("complete");
    expect(stateOf(steps, "reviewPlan")).toBe("current");
    expect(stateOf(steps, "sceneMappings")).toBe("locked");
  });

  it("reviewPlan completes once a real execution plan exists, unlocking sceneMappings as current", () => {
    const steps = computeWorkflowSteps(input({ workMapEntryCount: 1, hasPlan: true }));
    expect(stateOf(steps, "reviewPlan")).toBe("complete");
    expect(stateOf(steps, "sceneMappings")).toBe("current");
    expect(stateOf(steps, "firstPreview")).toBe("locked");
  });

  it("sceneMappings requires the plan to be APPROVED, not merely to exist", () => {
    const draft = computeWorkflowSteps(input({ workMapEntryCount: 1, hasPlan: true, planApproved: false }));
    expect(stateOf(draft, "sceneMappings")).toBe("current");

    const approved = computeWorkflowSteps(input({ workMapEntryCount: 1, hasPlan: true, planApproved: true }));
    expect(stateOf(approved, "sceneMappings")).toBe("complete");
    expect(stateOf(approved, "firstPreview")).toBe("current");
  });

  it("firstPreview requires the plan to be approved before it is even reachable (never a page-visit-based unlock)", () => {
    const steps = computeWorkflowSteps(input({ workMapEntryCount: 1, hasPlan: true, planApproved: false }));
    expect(stateOf(steps, "firstPreview")).toBe("locked");
  });

  it("firstPreview completes only once firstPreviewApproved is true - never from allScenesComplete alone", () => {
    const steps = computeWorkflowSteps(
      input({ workMapEntryCount: 1, hasPlan: true, planApproved: true, allScenesComplete: true, firstPreviewApproved: false })
    );
    expect(stateOf(steps, "firstPreview")).toBe("current");
    expect(stateOf(steps, "finalPreview")).toBe("locked");
  });

  it("finalPreview and render both unlock together once allScenesComplete - the same real RENDER dispatch precondition, never a fabricated separate flag", () => {
    const inProgress = computeWorkflowSteps(
      input({ workMapEntryCount: 1, hasPlan: true, planApproved: true, firstPreviewApproved: true, allScenesComplete: false })
    );
    expect(stateOf(inProgress, "finalPreview")).toBe("current");
    expect(stateOf(inProgress, "render")).toBe("locked");

    const allDone = computeWorkflowSteps(
      input({ workMapEntryCount: 1, hasPlan: true, planApproved: true, firstPreviewApproved: true, allScenesComplete: true })
    );
    expect(stateOf(allDone, "finalPreview")).toBe("complete");
    expect(stateOf(allDone, "render")).toBe("current");
  });

  it("render completes only once a real render artifact exists", () => {
    const steps = computeWorkflowSteps(
      input({ workMapEntryCount: 1, hasPlan: true, planApproved: true, firstPreviewApproved: true, allScenesComplete: true, hasRenderArtifact: true })
    );
    expect(stateOf(steps, "render")).toBe("complete");
  });

  it("every step is complete once the whole real workflow has actually happened", () => {
    const steps = computeWorkflowSteps(
      input({ workMapEntryCount: 3, hasPlan: true, planApproved: true, firstPreviewApproved: true, allScenesComplete: true, hasRenderArtifact: true })
    );
    expect(steps.every((s) => s.state === "complete")).toBe(true);
  });
});

describe("currentStepIndex", () => {
  it("points at the real 'current' step", () => {
    const steps = computeWorkflowSteps(input({ workMapEntryCount: 1 }));
    expect(currentStepIndex(steps)).toBe(2); // reviewPlan
  });

  it("falls back to just before the first locked step when nothing is explicitly current (should not normally happen, but never crashes)", () => {
    const steps = [
      { id: "upload" as const, state: "complete" as const },
      { id: "tellClaude" as const, state: "locked" as const }
    ];
    expect(currentStepIndex(steps)).toBe(0);
  });

  it("points at the last step once everything is complete", () => {
    const steps = computeWorkflowSteps(
      input({ workMapEntryCount: 3, hasPlan: true, planApproved: true, firstPreviewApproved: true, allScenesComplete: true, hasRenderArtifact: true })
    );
    expect(currentStepIndex(steps)).toBe(6);
  });
});
