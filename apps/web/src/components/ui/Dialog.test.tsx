// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { renderWithLocale } from "../../test-utils/render-with-locale";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    renderWithLocale(
      <Dialog open={false} onClose={() => {}} title="Test">
        <p>Body</p>
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders as an accessible dialog with the given title when open", () => {
    renderWithLocale(
      <Dialog open={true} onClose={() => {}} title="Worker details">
        <p>Body content</p>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    screen.getByText("Worker details");
    screen.getByText("Body content");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderWithLocale(
      <Dialog open={true} onClose={onClose} title="Test">
        <p>Body</p>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    renderWithLocale(
      <Dialog open={true} onClose={onClose} title="Test">
        <p>Body</p>
      </Dialog>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop itself (not the dialog content) is clicked", () => {
    const onClose = vi.fn();
    const { container } = renderWithLocale(
      <Dialog open={true} onClose={onClose} title="Test">
        <p>Body</p>
      </Dialog>
    );
    const overlay = container.querySelector(".overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the dialog content", () => {
    const onClose = vi.fn();
    renderWithLocale(
      <Dialog open={true} onClose={onClose} title="Test">
        <p>Body content</p>
      </Dialog>
    );
    fireEvent.mouseDown(screen.getByText("Body content"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the Hebrew close label when the active locale is he", () => {
    renderWithLocale(
      <Dialog open={true} onClose={() => {}} title="Test">
        <p>Body</p>
      </Dialog>,
      { locale: "he" }
    );
    screen.getByRole("button", { name: "סגירה" });
  });
});
