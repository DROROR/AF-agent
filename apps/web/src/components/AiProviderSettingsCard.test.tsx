// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderSettingsCard } from "./AiProviderSettingsCard";
import { LocaleProvider } from "./LocaleProvider";
import { stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

const NOT_CONNECTED = { status: { connected: false, provider: null, model: null, last4: null, lastVerifiedAt: null } };
const CONNECTED = { status: { connected: true, provider: "ANTHROPIC", model: "claude-sonnet-5", last4: "WXYZ", lastVerifiedAt: "2026-08-28T00:00:00.000Z" } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderCard(): void {
  render(
    <LocaleProvider>
      <AiProviderSettingsCard />
    </LocaleProvider>
  );
}

function fillApiKey(value: string): void {
  fireEvent.change(screen.getByLabelText("API key"), { target: { value } });
}

describe("AiProviderSettingsCard", () => {
  it("shows Not connected and opens the manage form immediately when nothing is connected yet", async () => {
    stubFetchByUrl({ "/api/settings/ai-provider": { status: 200, body: NOT_CONNECTED } });
    renderCard();

    await waitFor(() => expect(screen.getByText("Not connected")).not.toBeNull());
    expect(screen.getByLabelText("API key")).not.toBeNull();
  });

  it("shows a Connected badge and collapses to a summary when already connected", async () => {
    stubFetchByUrl({ "/api/settings/ai-provider": { status: 200, body: CONNECTED } });
    renderCard();

    await waitFor(() => expect(screen.getByText("Connected")).not.toBeNull());
    expect(screen.getByText(/claude-sonnet-5/)).not.toBeNull();
    expect(screen.queryByLabelText("API key")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByLabelText("API key")).not.toBeNull();
  });

  it("surfaces the real sanitized error reason on Save & Connect failure - never a generic message", async () => {
    stubFetchByUrl({
      "/api/settings/ai-provider/test": { status: 200, body: { ok: true, reason: null } },
      "/api/settings/ai-provider": [
        { status: 200, body: NOT_CONNECTED },
        {
          status: 400,
          body: { error: { code: "AI_PROVIDER_CONNECTION_FAILED", message: "Encryption is not configured on this server. Contact an administrator.", requestId: "req-1" } }
        }
      ]
    });
    renderCard();
    await waitFor(() => expect(screen.getByText("Not connected")).not.toBeNull());

    fillApiKey("sk-ant-a-real-looking-key-value");
    fireEvent.click(screen.getByRole("button", { name: "Save & Connect" }));

    await waitFor(() => expect(screen.getByText("Connection failed")).not.toBeNull());
    expect(screen.getByText("Encryption is not configured on this server. Contact an administrator.")).not.toBeNull();
    expect(screen.queryByText("An unexpected error occurred")).toBeNull();
  });

  it("surfaces a real invalid-key reason from Test Connection", async () => {
    stubFetchByUrl({
      "/api/settings/ai-provider": { status: 200, body: NOT_CONNECTED },
      "/api/settings/ai-provider/test": { status: 200, body: { ok: false, reason: "Invalid API key" } }
    });
    renderCard();
    await waitFor(() => expect(screen.getByText("Not connected")).not.toBeNull());

    fillApiKey("sk-ant-a-wrong-key-value-here");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("Invalid API key")).not.toBeNull());
  });

  it("connects successfully and shows the masked connected status - never the raw key", async () => {
    stubFetchByUrl({
      "/api/settings/ai-provider/test": { status: 200, body: { ok: true, reason: null } },
      "/api/settings/ai-provider": [{ status: 200, body: NOT_CONNECTED }, { status: 201, body: CONNECTED }]
    });
    renderCard();
    await waitFor(() => expect(screen.getByText("Not connected")).not.toBeNull());

    fillApiKey("sk-ant-a-real-looking-key-value");
    fireEvent.click(screen.getByRole("button", { name: "Save & Connect" }));

    await waitFor(() => expect(screen.getByText("Connected")).not.toBeNull());
    expect(screen.queryByText("sk-ant-a-real-looking-key-value")).toBeNull();
  });

  it("lists OpenAI and Google Gemini as coming soon - never a fake Connected state", async () => {
    stubFetchByUrl({ "/api/settings/ai-provider": { status: 200, body: NOT_CONNECTED } });
    renderCard();

    await waitFor(() => expect(screen.getByText("OpenAI (coming soon)")).not.toBeNull());
    expect(screen.getByText("Google Gemini (coming soon)")).not.toBeNull();
  });
});
