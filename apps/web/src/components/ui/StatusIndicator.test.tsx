// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusIndicator } from "./StatusIndicator";
import { renderWithLocale } from "../../test-utils/render-with-locale";

afterEach(cleanup);

describe("StatusIndicator", () => {
  it("reuses StatusBadge's own tone mapping - ONLINE renders the positive dot", () => {
    renderWithLocale(<StatusIndicator status="ONLINE" />);
    const dot = document.querySelector(".status-indicator__dot");
    expect(dot?.className).toContain("status-indicator__dot--positive");
    screen.getByText("Online");
  });

  it("UNKNOWN renders the neutral dot, never negative", () => {
    renderWithLocale(<StatusIndicator status="UNKNOWN" />);
    const dot = document.querySelector(".status-indicator__dot");
    expect(dot?.className).toContain("status-indicator__dot--neutral");
    expect(dot?.className).not.toContain("negative");
  });

  it("accepts an override label distinct from the default status label", () => {
    renderWithLocale(<StatusIndicator status="OK" label="All systems normal" />);
    screen.getByText("All systems normal");
    expect(screen.queryByText("OK")).toBeNull();
  });
});
