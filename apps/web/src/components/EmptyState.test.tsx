// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders its title and description with an accessible status role", () => {
    render(<EmptyState title="No projects yet" description="Start a new project to begin." />);
    screen.getByRole("status");
    screen.getByText("No projects yet");
    screen.getByText("Start a new project to begin.");
  });

  it("renders an optional action", () => {
    render(<EmptyState title="No projects yet" action={<button type="button">New project</button>} />);
    screen.getByRole("button", { name: "New project" });
  });
});
