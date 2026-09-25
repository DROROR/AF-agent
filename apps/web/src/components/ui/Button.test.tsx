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

/**
 * REAL 2026-09-25 INCIDENT: the daily operator repeatedly got stuck on
 * greyed-out buttons with nothing on screen explaining them, and had to ask
 * every time. `disabledReason` is the shared fix, so these pin the two
 * properties every call site relies on: the reason is really shown AND
 * really attached to the control, and an ENABLED button never grows an
 * explanation (so a call site can compute one unconditionally).
 */
describe("Button - disabledReason (REAL 2026-09-25 wayfinding incident)", () => {
  it("shows the reason and points the button at it with aria-describedby", () => {
    render(
      <Button disabled disabledReason="Your editing computer is offline.">
        Render
      </Button>
    );
    const button = screen.getByRole("button", { name: "Render" });
    const reason = screen.getByText("Your editing computer is offline.");
    expect(button.getAttribute("aria-describedby")).toBe(reason.getAttribute("id"));
    // Also discoverable by hover, which is what people try first.
    expect(button.getAttribute("title")).toBe("Your editing computer is offline.");
  });

  it("renders no explanation and no aria-describedby while the button is ENABLED, even when a reason is passed", () => {
    // Call sites compute the reason inline next to `disabled`, so an enabled
    // button routinely still receives one - it must stay completely inert.
    const { container } = render(<Button disabledReason="Your editing computer is offline.">Render</Button>);
    expect(screen.queryByText("Your editing computer is offline.")).toBeNull();
    expect(screen.getByRole("button", { name: "Render" }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByRole("button", { name: "Render" }).getAttribute("title")).toBeNull();
    // The wrapper is always in the DOM but is layout-transparent until it
    // has something to say (display: contents - see Button.tsx).
    expect(container.querySelector(".btn-with-reason")!.getAttribute("data-has-reason")).toBeNull();
  });

  it("keeps the very same <button> DOM node when it flips from disabled to enabled - focus and held references must survive", () => {
    // Regression: an earlier version added the reason wrapper only while
    // disabled, so React replaced the button element the moment it became
    // usable. A real ProjectExportTab test caught it by holding a reference
    // across the transition and finding it permanently disabled.
    const { rerender } = render(
      <Button disabled disabledReason="Your editing computer is offline.">
        Render
      </Button>
    );
    const before = screen.getByRole("button", { name: "Render" });
    rerender(<Button disabledReason="Your editing computer is offline.">Render</Button>);
    expect(screen.getByRole("button", { name: "Render" })).toBe(before);
    expect((before as HTMLButtonElement).disabled).toBe(false);
  });

  it("never leaks the reason prop onto the DOM button as an attribute", () => {
    render(
      <Button disabled disabledReason="Choose a master composition first.">
        Save
      </Button>
    );
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("disabledReason")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("disabledreason")).toBeNull();
  });

  it("shows nothing extra when disabled with no reason given - existing call sites are untouched", () => {
    const { container } = render(
      <Button disabled>
        Approve
      </Button>
    );
    expect(container.querySelector(".btn-with-reason")!.getAttribute("data-has-reason")).toBeNull();
    expect(container.querySelector(".btn-disabled-reason")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" }).getAttribute("aria-describedby")).toBeNull();
  });
});
