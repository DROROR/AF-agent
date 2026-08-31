// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button";

afterEach(() => {
  cleanup();
});

describe("Button - danger variant (client-handoff completion phase, section J)", () => {
  it("applies btn--danger only when variant='danger' is explicitly requested", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("btn--danger");
  });

  it("never applies btn--danger for the default (secondary) variant", () => {
    render(<Button>Cancel</Button>);
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.className).not.toContain("btn--danger");
    expect(button.className).toContain("btn--secondary");
  });

  it("never applies btn--danger for the primary variant", () => {
    render(<Button variant="primary">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).not.toContain("btn--danger");
  });
});
