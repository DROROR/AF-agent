// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./SignupForm";
import { renderWithLocale } from "../../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fillForm(fields: { name: string; email: string; password: string; confirmPassword: string }): void {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: fields.name } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: fields.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: fields.password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: fields.confirmPassword } });
}

describe("SignupForm", () => {
  it("shows a mismatched-password error and never calls fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderWithLocale(<SignupForm />);
    fillForm({ name: "Ada", email: "ada@example.com", password: "correct-horse", confirmPassword: "different" });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/do not match/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a duplicate-email error returned from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: "CONFLICT", message: "An account with this email already exists", requestId: "r1" }
        })
      })
    );

    renderWithLocale(<SignupForm />);
    fillForm({ name: "Ada", email: "ada@example.com", password: "correct-horse", confirmPassword: "correct-horse" });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("An account with this email already exists")
    );
  });

  it("rejects a password under 8 characters before ever calling fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderWithLocale(<SignupForm />);
    fillForm({ name: "Ada", email: "ada@example.com", password: "short", confirmPassword: "short" });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/at least 8 characters/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
