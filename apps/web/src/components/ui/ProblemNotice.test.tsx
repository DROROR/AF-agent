// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProblemNotice } from "./ProblemNotice";
import { renderWithLocale } from "../../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  document.documentElement.setAttribute("lang", "en");
});

/**
 * 2026-10-04: a failure was shown as an untrue title ("Could not dispatch
 * this job") over a raw worker sentence. The raw text is the right thing to
 * keep and the wrong thing to lead with.
 */
describe("ProblemNotice", () => {
  it("leads with the plain title and what to do, and keeps the raw message word for word behind a CLOSED disclosure", () => {
    const raw = "operation 2 (SET_TEXT) failed: the layer could not be found";
    renderWithLocale(<ProblemNotice title="The video could not be built" description="Press Try again." technicalDetails={raw} />);

    const alert = screen.getByRole("alert");
    expect(alert.querySelector(".state-panel__title")?.textContent).toBe("The video could not be built");
    expect(alert.querySelector(".state-panel__description")?.textContent).toBe("Press Try again.");
    const details = alert.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Technical details");
    expect(details.querySelector("pre")?.textContent).toBe(raw);
    // Never the headline.
    expect(alert.querySelector(".state-panel__title")?.textContent).not.toContain("SET_TEXT");
  });

  it("draws no disclosure at all when there is nothing technical to keep", () => {
    renderWithLocale(<ProblemNotice title="That did not go through" />);
    expect(screen.getByRole("alert").querySelector("details")).toBeNull();
  });

  it("labels the disclosure in Hebrew for a Hebrew reader", () => {
    renderWithLocale(<ProblemNotice title="כותרת" technicalDetails="raw" />, { locale: "he" });
    expect(screen.getByRole("alert").querySelector("summary")?.textContent).toBe("פרטים טכניים");
  });
});
