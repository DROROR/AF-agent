// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeActionButton } from "./ClaudeActionButton";

afterEach(() => {
  cleanup();
});

/**
 * The one reusable button for a genuine Anthropic/Claude API action -
 * every real Claude action must read "Claude — <Action>" (E: "Every
 * genuine AI action should use: [official Claude icon] Claude — <Action>").
 */
describe("ClaudeActionButton", () => {
  it('always prefixes the label with "Claude — " - callers never have to repeat the prefix themselves', () => {
    render(<ClaudeActionButton label="Create Video Plan" onClick={() => {}} />);
    screen.getByRole("button", { name: "Claude — Create Video Plan" });
  });

  it("shows the busy label instead of the normal label while busy, and disables the button", () => {
    render(<ClaudeActionButton label="Generate Suggestions" busyLabel="Thinking…" busy onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Claude — Thinking…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("is not busy by default - the normal label renders and the button is enabled", () => {
    render(<ClaudeActionButton label="Ask Again" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Claude — Ask Again" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<ClaudeActionButton label="Suggest Text" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Claude — Suggest Text" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the dedicated btn--claude style class, never a generic primary/secondary one", () => {
    render(<ClaudeActionButton label="Create Video Plan" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Claude — Create Video Plan" });
    expect(button.className).toContain("btn--claude");
    expect(button.className).not.toContain("btn--primary");
  });
});
