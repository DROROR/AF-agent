import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CREDENTIAL_FILE_PROTECTION_CAVEAT, CredentialStore } from "./credential-store.js";

describe("CredentialStore", () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "dyo-worker-creds-"));
  });

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("returns null when no credentials have been persisted yet", () => {
    const store = new CredentialStore(workRoot);
    expect(store.load()).toBeNull();
  });

  it("round-trips saved credentials", () => {
    const store = new CredentialStore(workRoot);
    store.save({ workerId: "11111111-1111-1111-1111-111111111111", workerToken: "secret-token" });
    expect(store.load()).toEqual({
      workerId: "11111111-1111-1111-1111-111111111111",
      workerToken: "secret-token"
    });
  });

  it("creates the state directory if it does not exist", () => {
    const store = new CredentialStore(path.join(workRoot, "nested", "root"));
    store.save({ workerId: "11111111-1111-1111-1111-111111111111", workerToken: "secret-token" });
    expect(store.load()?.workerToken).toBe("secret-token");
  });

  it("returns null for a corrupt/invalid credentials file rather than throwing", () => {
    const store = new CredentialStore(workRoot);
    store.save({ workerId: "11111111-1111-1111-1111-111111111111", workerToken: "secret-token" });
    // Overwrite with something that no longer matches the schema.
    store.save({ workerId: "not-a-uuid", workerToken: "x" } as never);
    expect(store.load()).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "enforces owner-only file mode 0o600 on POSIX systems",
    () => {
      const store = new CredentialStore(workRoot);
      store.save({ workerId: "11111111-1111-1111-1111-111111111111", workerToken: "secret-token" });
      const stats = statSync(path.join(workRoot, "state", "worker-credentials.json"));
      expect(stats.mode & 0o777).toBe(0o600);
    }
  );
});

describe("CREDENTIAL_FILE_PROTECTION_CAVEAT", () => {
  it("documents that POSIX file mode does not protect this file on Windows", () => {
    expect(CREDENTIAL_FILE_PROTECTION_CAVEAT).toMatch(/POSIX/);
    expect(CREDENTIAL_FILE_PROTECTION_CAVEAT).toMatch(/Windows/);
    expect(CREDENTIAL_FILE_PROTECTION_CAVEAT).toMatch(/real Windows worker/);
  });
});
