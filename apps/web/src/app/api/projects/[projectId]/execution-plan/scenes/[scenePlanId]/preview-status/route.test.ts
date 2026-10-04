// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { GET as getStatus } from "./route";
import { GET as getFile } from "../preview/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getMockCookie.mockReset();
});

const params = Promise.resolve({ projectId: "11111111-1111-1111-1111-111111111111", scenePlanId: "scene-1" });

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
    arrayBuffer: async () => new TextEncoder().encode("bytes").buffer,
    text: async () => JSON.stringify({ preview: null }),
    json: async () => ({ preview: null })
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const calledUrl = (fetchMock: ReturnType<typeof vi.fn>): string => String((fetchMock.mock.calls[0] as unknown[])[0]);

/**
 * REAL 2026-10-04 DEFECT: both proxies dropped the query string, so a request
 * for one slot's own evidence frame reached the API as a request for the
 * scene's latest frame - and every slot was shown whichever frame had been
 * captured last.
 */
describe("scene preview proxies forward which slot is being asked about", () => {
  it.each([
    ["preview-status", getStatus],
    ["preview", getFile]
  ])("%s: mappingId reaches the API", async (name, handler) => {
    getMockCookie.mockReturnValue({ value: "token" });
    const fetchMock = stubApi();
    await handler(new Request(`http://x/api/whatever?mappingId=slot%2Fa`), { params });
    expect(calledUrl(fetchMock).endsWith(`/scenes/scene-1/${name}?mappingId=slot%2Fa`)).toBe(true);
  });

  it.each([
    ["preview-status", getStatus],
    ["preview", getFile]
  ])("%s: with no mappingId the request is unchanged, and nothing else a caller appends is forwarded", async (name, handler) => {
    getMockCookie.mockReturnValue({ value: "token" });
    const fetchMock = stubApi();
    await handler(new Request(`http://x/api/whatever?v=1&other=2`), { params });
    expect(calledUrl(fetchMock).endsWith(`/scenes/scene-1/${name}`)).toBe(true);
  });
});
