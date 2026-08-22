import { describe, expect, it } from "vitest";
import { RendererConfigError } from "../../errors.js";
import { loadShotstackConfig } from "./shotstack-env.js";

describe("loadShotstackConfig", () => {
  it("defaults to the sandbox base URL", () => {
    const config = loadShotstackConfig({ SHOTSTACK_API_KEY: "test-key" } as NodeJS.ProcessEnv);
    expect(config.env).toBe("sandbox");
    expect(config.baseUrl).toBe("https://api.shotstack.io/edit/stage");
  });

  it("resolves the production base URL when requested", () => {
    const config = loadShotstackConfig({
      SHOTSTACK_API_KEY: "test-key",
      SHOTSTACK_ENV: "production"
    } as NodeJS.ProcessEnv);
    expect(config.baseUrl).toBe("https://api.shotstack.io/edit/v1");
  });

  it("throws RendererConfigError when the API key is missing", () => {
    expect(() => loadShotstackConfig({} as NodeJS.ProcessEnv)).toThrow(RendererConfigError);
  });

  it("throws RendererConfigError for an unrecognized SHOTSTACK_ENV value", () => {
    expect(() =>
      loadShotstackConfig({
        SHOTSTACK_API_KEY: "test-key",
        SHOTSTACK_ENV: "staging"
      } as NodeJS.ProcessEnv)
    ).toThrow(RendererConfigError);
  });

  it("never includes the api key in a thrown config error's message", () => {
    try {
      loadShotstackConfig({ SHOTSTACK_API_KEY: "super-secret-value" } as NodeJS.ProcessEnv);
    } catch {
      // not expected to throw in this case
    }
    try {
      loadShotstackConfig({} as NodeJS.ProcessEnv);
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-value");
    }
  });
});
