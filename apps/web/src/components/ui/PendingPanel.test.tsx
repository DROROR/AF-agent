// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";
import { PendingPanel } from "./PendingPanel";

afterEach(cleanup);

describe("PendingPanel", () => {
  it("renders its title and description with an accessible status role", () => {
    render(<PendingPanel title="Not available yet" description="This section requires a future API." />);
    screen.getByRole("status");
    screen.getByText("Not available yet");
    screen.getByText("This section requires a future API.");
  });
});
