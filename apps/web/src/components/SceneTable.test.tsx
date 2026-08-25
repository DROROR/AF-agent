// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SceneTable } from "./SceneTable";
import { renderWithLocale } from "../test-utils/render-with-locale";
import type { SceneTableRow } from "../lib/scene-table-types";

afterEach(cleanup);

function row(overrides: Partial<SceneTableRow> = {}): SceneTableRow {
  return {
    sceneId: "scene-1",
    placeholderId: "placeholder-1",
    use: true,
    finalOrder: 1,
    sceneLabel: "Scene 01",
    placeholderLabel: "Left Phone",
    placeholderType: "phone_screen",
    assetName: "clip-01.mp4",
    hasText: false,
    sourceTimestampSeconds: 12.5,
    finalDurationSeconds: 4,
    notes: "",
    approvalState: "pending",
    ...overrides
  };
}

describe("SceneTable", () => {
  it("shows an honest empty state when given no rows - never invents placeholder rows", () => {
    renderWithLocale(<SceneTable rows={[]} />);
    screen.getByText("No scenes to review yet");
  });

  it("renders a row with the real placeholder type label, never a raw enum value", () => {
    renderWithLocale(<SceneTable rows={[row()]} />);
    screen.getByText("Scene 01");
    screen.getByText("Left Phone");
    screen.getByText("Phone screen");
    screen.getByText("clip-01.mp4");
  });

  it("formats source timestamp and final duration as mm:ss", () => {
    renderWithLocale(<SceneTable rows={[row({ sourceTimestampSeconds: 65, finalDurationSeconds: 90 })]} />);
    screen.getByText("1:05");
    screen.getByText("1:30");
  });

  it("shows an em-dash for null timestamp/duration/asset rather than fabricating a value", () => {
    renderWithLocale(<SceneTable rows={[row({ sourceTimestampSeconds: null, finalDurationSeconds: null, assetName: null })]} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("maps approval state to the correct status tone", () => {
    renderWithLocale(<SceneTable rows={[row({ approvalState: "approved" })]} />);
    expect(screen.getByText("OK").className).toContain("status-badge--positive");
  });
});
