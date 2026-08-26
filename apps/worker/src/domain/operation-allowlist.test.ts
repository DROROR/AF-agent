import { WORKER_CAPABILITIES } from "@dyo/schemas";
import { describe, expect, it } from "vitest";
import { CURRENT_WORKER_CAPABILITIES, isAllowedOperation } from "./operation-allowlist.js";

describe("isAllowedOperation", () => {
  it("accepts every capability in the shared allowlist", () => {
    for (const capability of WORKER_CAPABILITIES) {
      expect(isAllowedOperation(capability)).toBe(true);
    }
  });

  it("rejects an operation not in the allowlist", () => {
    expect(isAllowedOperation("DELETE_EVERYTHING")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isAllowedOperation("")).toBe(false);
  });

  it("rejects an attempt to smuggle a shell command as an operation", () => {
    expect(isAllowedOperation("rm -rf /")).toBe(false);
    expect(isAllowedOperation("powershell.exe -Command Remove-Item")).toBe(false);
  });

  it("only claims capabilities this build actually implements", () => {
    for (const capability of CURRENT_WORKER_CAPABILITIES) {
      expect(WORKER_CAPABILITIES).toContain(capability);
    }
    expect(CURRENT_WORKER_CAPABILITIES).toEqual(["CHECK_HEALTH", "INSPECT_TEMPLATE", "INSPECT_SCENE_EVIDENCE"]);
  });
});
