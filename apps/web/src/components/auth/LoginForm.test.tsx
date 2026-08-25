// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";
import { renderWithLocale } from "../../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fillAndSubmit(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm", () => {
  it("shows a field-level error and never calls fetch for an invalid email", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderWithLocale(<LoginForm />);
    fillAndSubmit("not-an-email", "whatever123");

    expect(screen.getByRole("alert").textContent).toMatch(/valid email/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the server's error message on a failed login without navigating away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: "UNAUTHORIZED", message: "Invalid email or password", requestId: "r1" } })
      })
    );

    renderWithLocale(<LoginForm />);
    fillAndSubmit("ada@example.com", "wrong-password");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid email or password"));
    const button = screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("shows a loading state while the request is in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)))
    );

    renderWithLocale(<LoginForm />);
    fillAndSubmit("ada@example.com", "correct-horse");

    const button = (await screen.findByRole("button", { name: /signing in/i })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    resolveFetch({ ok: false, json: async () => ({ error: { code: "UNAUTHORIZED", message: "nope", requestId: "r" } }) });
  });

  it("renders in Hebrew (RTL) when the active locale is he - real field labels and submit text, not English fallbacks", () => {
    renderWithLocale(<LoginForm />, { locale: "he" });
    screen.getByLabelText("אימייל");
    screen.getByLabelText("סיסמה");
    screen.getByRole("button", { name: "התחברות" });
  });
});
