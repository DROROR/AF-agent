// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getMockCookie.mockReset();
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

describe("GET .../execution-plan/render-templates proxy (2026-10-21)", () => {
  it("asks the real API for this project's reported template names, as a GET, and hands back what it said", async () => {
    getMockCookie.mockReturnValue({ value: "token" });
    const body = { templates: null };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify(body),
      json: async () => body
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x"), { params: Promise.resolve({ projectId: PROJECT_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/api/projects/${PROJECT_ID}/execution-plan/render-templates`);
    expect(init.method).toBe("GET");
  });
});
