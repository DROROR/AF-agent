// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScenesGuide } from "./ScenesGuide";

afterEach(() => {
  cleanup();
});

const steps = (done: boolean[]) =>
  ["First", "Second", "Third"].map((title, index) => ({ title: `${title}.`, detail: `how to do the ${title.toLowerCase()} one`, done: done[index]! }));

/**
 * REAL 2026-10-04: a non-technical client could not tell where to start on
 * the Scenes tab, what each button was for, or when they were finished.
 */
describe("ScenesGuide", () => {
  it("marks the first unfinished step as the one to do now, and says how", () => {
    render(<ScenesGuide heading="What to do" steps={steps([true, false, false])} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual(["done", "now", "later"]);
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("how to do the second one")).toBeTruthy();
  });

  it("does not explain a step the client has not reached - only names it", () => {
    render(<ScenesGuide heading="What to do" steps={steps([false, false, false])} />);
    expect(screen.getByText("Third.")).toBeTruthy();
    expect(screen.queryByText("how to do the third one")).toBeNull();
  });

  it("with everything done, no step is 'now'", () => {
    render(<ScenesGuide heading="What to do" steps={steps([true, true, true])} />);
    expect(screen.getAllByRole("listitem").every((item) => item.getAttribute("data-state") === "done")).toBe(true);
  });
});
