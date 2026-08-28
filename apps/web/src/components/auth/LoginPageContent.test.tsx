// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPageContent } from "./LoginPageContent";
import { renderWithLocale } from "../../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LoginPageContent", () => {
  it("renders the real login form", () => {
    renderWithLocale(<LoginPageContent />);
    screen.getByLabelText("Email");
    screen.getByLabelText("Password");
    screen.getByRole("button", { name: /sign in/i });
  });

  it("login-only mode: never offers a Sign up / Create account link - Signup is temporarily disabled", () => {
    renderWithLocale(<LoginPageContent />);
    expect(screen.queryByRole("link", { name: /sign up|create account|create one/i })).toBeNull();
    expect(screen.queryByText(/sign up|create account/i)).toBeNull();
  });
});
