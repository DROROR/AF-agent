import { describe, expect, it } from "vitest";
import {
  findStaleDisposableCopies,
  disposableCopyPathFor,
  isDisposableCopyPath,
  withDisposableProject,
  DISPOSABLE_FILENAME_MARKER,
  QUARANTINE_SUFFIX,
  type FileOps
} from "./disposable-project.js";
import { ProjectStateLock } from "./project-state-lock.js";

const TARGET = "C:\\DYO-Agent\\copies\\template\\App_Promo.aep";
const SOURCE_SHA = "a".repeat(64);
const WORKING = "C:\\DYO-Agent\\execution-sessions\\s1\\working-copy.aep";
const WORKING_SHA = "b".repeat(64);
const NOW = new Date("2026-09-19T00:00:00.000Z");

interface FakeAeOptions {
  /** What AE reports it is holding before the inspection. */
  state?: Record<string, unknown> | "unreadable" | "malformed";
  /** Footage the opened copy cannot resolve. */
  missingFootage?: { name: string; path?: string }[];
  footageCheck?: "malformed" | "fails";
  openFails?: boolean;
  /** AE opens something other than what was asked for. */
  opensInstead?: string | null | undefined;
  closeFails?: boolean;
  restoreFails?: boolean;
  restoreOpensInstead?: string | null;
}

/** A fake After Effects that answers the wrapper's four fixed scripts. */
function fakeAe(options: FakeAeOptions = {}) {
  const calls: string[] = [];
  const run = async (script: string): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> => {
    if (script.includes("DYO_SAFE_INSPECTION_DESCRIBE_STATE")) {
      calls.push("state");
      if (options.state === "unreadable") {
        return { ok: false, reason: "MCP timeout" };
      }
      if (options.state === "malformed") {
        return { ok: true, value: { resultingValue: { nonsense: true } } };
      }
      return {
        ok: true,
        value: { resultingValue: options.state ?? { projectOpen: false, projectPath: null, projectName: null, itemCount: 0, dirty: null, dirtyAvailable: true } }
      };
    }
    if (script.includes("DYO_SAFE_INSPECTION_DESCRIBE_FOOTAGE")) {
      calls.push("footage");
      if (options.footageCheck === "fails") {
        return { ok: false, reason: "MCP timeout" };
      }
      if (options.footageCheck === "malformed") {
        return { ok: true, value: { resultingValue: { nope: 1 } } };
      }
      return { ok: true, value: { resultingValue: { footageItemsChecked: 3, missing: options.missingFootage ?? [] } } };
    }
    if (script.includes("DYO_SAFE_INSPECTION_CLOSE_DISPOSABLE")) {
      calls.push("close");
      return options.closeFails ? { ok: false, reason: "the open project is not this operation's disposable copy" } : { ok: true, value: { resultingValue: { closed: true } } };
    }
    // buildOpenProjectScript - the requested path is embedded in the script.
    const requested = /new File\((".*?")\)/.exec(script)?.[1];
    const requestedPath = requested ? (JSON.parse(requested) as string) : null;
    const isRestore = requestedPath !== null && !requestedPath.includes(DISPOSABLE_FILENAME_MARKER);
    calls.push(isRestore ? "restore" : "open");
    if (isRestore) {
      if (options.restoreFails) {
        return { ok: false, reason: "app.open timed out" };
      }
      return { ok: true, value: { ok: true, resultingValue: { openedPath: options.restoreOpensInstead ?? requestedPath, openedName: "x" } } };
    }
    if (options.openFails) {
      return { ok: false, reason: "app.open timed out" };
    }
    return {
      ok: true,
      value: { ok: true, resultingValue: { openedPath: options.opensInstead === undefined ? requestedPath : options.opensInstead, openedName: "copy" } }
    };
  };
  return { run, calls };
}

interface FakeFsOptions {
  hashes?: Record<string, string>;
  /** Hash values returned on the SECOND read of a path - models a file changing mid-inspection. */
  hashesAfter?: Record<string, string>;
  directoryWritable?: boolean;
  copyFails?: boolean;
  copyProducesSha?: string;
  removeFails?: boolean;
  quarantineFails?: boolean;
  hashFailsFor?: string;
}

function fakeFs(options: FakeFsOptions = {}) {
  const removed: string[] = [];
  const quarantined: string[] = [];
  const copied: { from: string; to: string }[] = [];
  const copySources = new Map<string, string>();
  const reads = new Map<string, number>();
  const fileOps: FileOps = {
    async copy(from, to) {
      if (options.copyFails) {
        throw new Error("EACCES: permission denied");
      }
      copied.push({ from, to });
      // A real copy hashes identically to its source unless a test says otherwise.
      copySources.set(to, from);
    },
    async assertDirectoryWritable() {
      if (options.directoryWritable === false) {
        throw new Error("EACCES: permission denied, open 'probe.tmp'");
      }
    },
    async remove(filePath) {
      if (options.removeFails) {
        throw new Error("EBUSY: resource busy or locked");
      }
      removed.push(filePath);
    },
    async quarantine(filePath) {
      if (options.quarantineFails) {
        throw new Error("EPERM: operation not permitted");
      }
      quarantined.push(filePath);
      return `${filePath}${QUARANTINE_SUFFIX}`;
    },
    async hash(filePath) {
      if (options.hashFailsFor === filePath) {
        return { ok: false, reason: "ENOENT" };
      }
      const count = (reads.get(filePath) ?? 0) + 1;
      reads.set(filePath, count);
      if (count > 1 && options.hashesAfter?.[filePath]) {
        return { ok: true, sha256: options.hashesAfter[filePath] as string };
      }
      if (filePath.includes(DISPOSABLE_FILENAME_MARKER)) {
        if (options.copyProducesSha) {
          return { ok: true, sha256: options.copyProducesSha };
        }
        const from = copySources.get(filePath);
        return { ok: true, sha256: (from ? options.hashes?.[from] : undefined) ?? SOURCE_SHA };
      }
      const known = options.hashes?.[filePath];
      return known ? { ok: true, sha256: known } : { ok: true, sha256: SOURCE_SHA };
    }
  };
  return { fileOps, removed, quarantined, copied };
}

function request(overrides: Partial<Parameters<typeof withDisposableProject>[1]> = {}) {
  return {
    operation: "INSPECT_TEMPLATE",
    targetPath: TARGET,
    targetSha256: SOURCE_SHA,
    sourceProjectPath: TARGET,
    sourceProjectSha256: SOURCE_SHA,
    ...overrides
  };
}

async function run(aeOptions: FakeAeOptions = {}, fsOptions: FakeFsOptions = {}, overrides: Parameters<typeof request>[0] = {}, inspect?: () => Promise<string>) {
  const ae = fakeAe(aeOptions);
  const fs = fakeFs(fsOptions);
  const result = await withDisposableProject(
    { runScript: ae.run as never, fileOps: fs.fileOps, lock: new ProjectStateLock(() => NOW), now: () => NOW },
    request(overrides),
    inspect ?? (async () => "inspected")
  );
  return { result, ae, fs };
}

describe("disposable copy naming", () => {
  it("places the copy beside the original so relative footage keeps the same base directory", () => {
    const copy = disposableCopyPathFor(TARGET, "abc");
    expect(copy).toBe("C:\\DYO-Agent\\copies\\template\\App_Promo.dyo-inspect-abc.aep");
  });

  it("recognises only its own copies, so stale-copy recovery can never target anything else", () => {
    expect(isDisposableCopyPath(disposableCopyPathFor(TARGET, "abc"))).toBe(true);
    expect(isDisposableCopyPath(TARGET)).toBe(false);
    expect(isDisposableCopyPath("C:\\work\\working-copy.aep")).toBe(false);
    expect(isDisposableCopyPath(`${disposableCopyPathFor(TARGET, "abc")}${QUARANTINE_SUFFIX}`)).toBe(false);
  });
});

describe("findStaleDisposableCopies", () => {
  it("lists only this wrapper's own leftovers, and never touches anything else", () => {
    const directory = "C:\\DYO-Agent\\copies\\template";
    const entries = [
      "App_Promo.aep",
      "App_Promo.dyo-inspect-abc.aep",
      "App_Promo.dyo-inspect-def.aep",
      "App_Promo.dyo-inspect-ghi.aep.quarantine",
      "client-footage.mov",
      "working-copy.aep"
    ];

    expect(findStaleDisposableCopies(directory, entries)).toEqual([
      "C:\\DYO-Agent\\copies\\template\\App_Promo.dyo-inspect-abc.aep",
      "C:\\DYO-Agent\\copies\\template\\App_Promo.dyo-inspect-def.aep"
    ]);
  });

  it("returns nothing for a directory with no leftovers of its own", () => {
    expect(findStaleDisposableCopies("C:\\x", ["a.aep", "b.mov"])).toEqual([]);
  });
});

describe("withDisposableProject - the happy path", () => {
  it("copies beside the original, opens the COPY, inspects it, closes, deletes and reports full evidence", async () => {
    const { result, ae, fs } = await run();

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.value).toBe("inspected");
    // The original was never opened - only the copy.
    expect(fs.copied[0]?.from).toBe(TARGET);
    expect(fs.copied[0]?.to).toContain(DISPOSABLE_FILENAME_MARKER);
    expect(ae.calls).toEqual(["state", "open", "footage", "close"]);
    expect(fs.removed).toHaveLength(1);

    const evidence = result.evidence;
    expect(evidence.targetActualSha256).toBe(SOURCE_SHA);
    expect(evidence.disposableSha256).toBe(SOURCE_SHA);
    expect(evidence.sourceSha256Before).toBe(SOURCE_SHA);
    expect(evidence.sourceSha256After).toBe(SOURCE_SHA);
    expect(evidence.restoration).toBe("NOTHING_TO_RESTORE");
    expect(evidence.cleanup).toBe("DELETED");
    expect(evidence.unresolvedFootage).toEqual([]);
  });

  it("hashes a session working copy before and after when the inspection concerns one", async () => {
    const { result } = await run({}, { hashes: { [WORKING]: WORKING_SHA } }, {
      targetPath: WORKING,
      targetSha256: WORKING_SHA,
      workingProjectPath: WORKING,
      workingProjectSha256: WORKING_SHA
    });

    expect(result.ok).toBe(true);
    expect(result.evidence.workingSha256Before).toBe(WORKING_SHA);
    expect(result.evidence.workingSha256After).toBe(WORKING_SHA);
  });
});

describe("withDisposableProject - refusals before anything is touched", () => {
  it("refuses while another project operation holds the lock", async () => {
    const lock = new ProjectStateLock(() => NOW);
    const held = lock.acquire("EXECUTE_FRAME");
    expect(held.ok).toBe(true);

    const result = await withDisposableProject(
      { runScript: fakeAe().run as never, fileOps: fakeFs().fileOps, lock, now: () => NOW },
      request(),
      async () => "never"
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("BUSY");
    expect(result.ok === false && result.reason).toContain("EXECUTE_FRAME");
  });

  it("releases the lock afterwards, so a second inspection can run", async () => {
    const lock = new ProjectStateLock(() => NOW);
    const deps = { runScript: fakeAe().run as never, fileOps: fakeFs().fileOps, lock, now: () => NOW };
    expect((await withDisposableProject(deps, request(), async () => "one")).ok).toBe(true);
    expect((await withDisposableProject(deps, request(), async () => "two")).ok).toBe(true);
  });

  it("refuses when the file to inspect does not match its expected hash", async () => {
    const { result, fs } = await run({}, { hashes: { [TARGET]: "c".repeat(64) } }, { sourceProjectPath: WORKING, sourceProjectSha256: SOURCE_SHA });
    expect(result.ok === false && result.code).toBe("TARGET_HASH_MISMATCH");
    expect(fs.copied).toHaveLength(0);
  });

  it("refuses when the directory beside the file is not writable - before After Effects is involved", async () => {
    const { result, ae, fs } = await run({}, { directoryWritable: false });
    expect(result.ok === false && result.code).toBe("TARGET_DIRECTORY_NOT_WRITABLE");
    expect(result.ok === false && result.reason).toContain("relative footage");
    expect(ae.calls).toEqual([]);
    expect(fs.copied).toHaveLength(0);
  });

  it("refuses when the copy cannot be made", async () => {
    const { result, ae } = await run({}, { copyFails: true });
    expect(result.ok === false && result.code).toBe("COPY_FAILED");
    expect(ae.calls).toEqual([]);
  });

  it("refuses when the copy does not hash identically to the file it came from", async () => {
    const { result, ae } = await run({}, { copyProducesSha: "d".repeat(64) });
    expect(result.ok === false && result.code).toBe("COPY_FAILED");
    expect(result.ok === false && result.reason).toContain("does not match the file it was copied from");
    expect(ae.calls).toEqual([]);
  });

  it("refuses when the immutable source already differs from its expected hash", async () => {
    const { result } = await run({}, { hashes: { [TARGET]: "e".repeat(64) } });
    expect(result.ok === false && result.code).toBe("PROTECTED_FILE_CHANGED");
  });
});

describe("withDisposableProject - what After Effects is already holding", () => {
  const openProject = (overrides: Record<string, unknown>) => ({
    projectOpen: true,
    projectPath: "C:\\Users\\Someone\\Documents\\their-project.aep",
    projectName: "their-project.aep",
    itemCount: 42,
    dirty: false,
    dirtyAvailable: true,
    ...overrides
  });

  it("refuses to touch a project holding unsaved changes, and never opens anything", async () => {
    const { result, ae, fs } = await run({ state: openProject({ dirty: true }) });
    expect(result.ok === false && result.code).toBe("AE_PROJECT_NOT_SAFE_TO_REPLACE");
    expect(result.ok === false && result.reason).toContain("only you can decide whether that work is kept");
    expect(ae.calls).toEqual(["state"]);
    expect(result.evidence.restoration).toBe("NOT_DISTURBED");
    // The copy it had already made is cleaned up.
    expect(fs.removed).toHaveLength(1);
    expect(result.evidence.cleanup).toBe("DELETED");
  });

  it("refuses an untitled, never-saved project", async () => {
    const { result, ae } = await run({ state: openProject({ projectPath: null, projectName: null, dirty: false }) });
    expect(result.ok === false && result.code).toBe("AE_PROJECT_NOT_SAFE_TO_REPLACE");
    expect(result.ok === false && result.reason).toContain("untitled");
    expect(ae.calls).toEqual(["state"]);
  });

  it("fails closed when the build exposes no reliable dirty-state flag and a project is open", async () => {
    const { result, ae } = await run({ state: openProject({ dirty: null, dirtyAvailable: false }) });
    expect(result.ok === false && result.code).toBe("AE_PROJECT_NOT_SAFE_TO_REPLACE");
    expect(result.ok === false && result.reason).toContain("no reliable unsaved-changes flag");
    expect(ae.calls).toEqual(["state"]);
  });

  it("proceeds when nothing is open at all, and reports nothing to restore", async () => {
    const { result } = await run({ state: { projectOpen: false, projectPath: null, projectName: null, itemCount: 0, dirty: null, dirtyAvailable: false } });
    expect(result.ok).toBe(true);
    expect(result.evidence.restoration).toBe("NOTHING_TO_RESTORE");
  });

  it("restores a verified-clean saved project afterwards, and verifies its identity", async () => {
    const { result, ae } = await run({ state: openProject({}) });
    expect(result.ok).toBe(true);
    expect(ae.calls).toEqual(["state", "open", "footage", "close", "restore"]);
    expect(result.evidence.restoration).toBe("RESTORED");
    expect(result.evidence.priorAeProjectState?.projectPath).toBe("C:\\Users\\Someone\\Documents\\their-project.aep");
  });

  it("reports RESTORE_FAILED loudly when the prior project cannot be reopened", async () => {
    const { result } = await run({ state: openProject({}), restoreFails: true });
    expect(result.ok).toBe(true); // the inspection itself succeeded...
    expect(result.evidence.restoration).toBe("RESTORE_FAILED"); // ...but this is never hidden
    expect(result.evidence.restorationNote).toContain("could not be reopened");
  });

  it("reports RESTORE_FAILED when After Effects reopens something else", async () => {
    const { result } = await run({ state: openProject({}), restoreOpensInstead: "C:\\somewhere\\other.aep" });
    expect(result.evidence.restoration).toBe("RESTORE_FAILED");
    expect(result.evidence.restorationNote).toContain("not the project it held before");
  });

  it("replaces a leftover disposable copy from an earlier run without trying to restore it", async () => {
    const stale = disposableCopyPathFor(TARGET, "earlier-run");
    const { result, ae } = await run({ state: openProject({ projectPath: stale, projectName: "stale copy" }) });
    expect(result.ok).toBe(true);
    expect(ae.calls).not.toContain("restore");
    expect(result.evidence.restoration).toBe("NOT_DISTURBED");
  });

  it("refuses when After Effects' state cannot be read or interpreted", async () => {
    for (const state of ["unreadable", "malformed"] as const) {
      const { result } = await run({ state });
      expect(result.ok === false && result.code).toBe("AE_STATE_UNKNOWN");
    }
  });
});

describe("withDisposableProject - opening, footage and inspection failures", () => {
  it("fails closed when the copy cannot be opened", async () => {
    const { result } = await run({ openFails: true });
    expect(result.ok === false && result.code).toBe("OPEN_FAILED");
  });

  it("fails closed when After Effects opens something other than the copy", async () => {
    const { result } = await run({ opensInstead: "C:\\somewhere\\else.aep" });
    expect(result.ok === false && result.code).toBe("OPEN_FAILED");
    expect(result.ok === false && result.reason).toContain("not this operation's disposable copy");
  });

  it("fails closed, rather than reporting misleading evidence, when the copy cannot resolve footage", async () => {
    const { result } = await run({ missingFootage: [{ name: "background.mov", path: "C:\\assets\\background.mov" }] });
    expect(result.ok === false && result.code).toBe("FOOTAGE_UNRESOLVED");
    expect(result.evidence.unresolvedFootage).toEqual(["background.mov (C:\\assets\\background.mov)"]);
    expect(result.ok === false && result.reason).toContain("missing content the original has");
  });

  it("fails closed when the footage check itself cannot be completed", async () => {
    for (const footageCheck of ["fails", "malformed"] as const) {
      const { result } = await run({ footageCheck });
      expect(result.ok === false && result.code).toBe("FOOTAGE_UNRESOLVED");
    }
  });

  it("still closes, restores and cleans up when the inspection itself throws", async () => {
    const ae = fakeAe({ state: { projectOpen: true, projectPath: "C:\\Users\\S\\p.aep", projectName: "p", itemCount: 3, dirty: false, dirtyAvailable: true } });
    const fs = fakeFs();
    const result = await withDisposableProject({ runScript: ae.run as never, fileOps: fs.fileOps, lock: new ProjectStateLock(() => NOW), now: () => NOW }, request(), async () => {
      throw new Error("the inspection blew up");
    });

    expect(result.ok === false && result.code).toBe("INSPECTION_FAILED");
    expect(result.ok === false && result.reason).toContain("the inspection blew up");
    expect(ae.calls).toEqual(["state", "open", "footage", "close", "restore"]);
    expect(result.evidence.restoration).toBe("RESTORED");
    expect(result.evidence.cleanup).toBe("DELETED");
  });
});

describe("withDisposableProject - closing and cleanup", () => {
  it("never deletes a copy After Effects may still hold open", async () => {
    const { result, fs } = await run({ closeFails: true });
    expect(fs.removed).toHaveLength(0);
    expect(result.evidence.cleanup).toBe("LEFT_IN_PLACE_STILL_OPEN");
    expect(result.evidence.cleanupNote).toContain("rather than deleted underneath After Effects");
  });

  it("quarantines the exact file when deletion fails - never a wildcard sweep", async () => {
    const { result, fs } = await run({}, { removeFails: true });
    expect(fs.quarantined).toHaveLength(1);
    expect(fs.quarantined[0]).toContain(DISPOSABLE_FILENAME_MARKER);
    expect(result.evidence.cleanup).toBe("QUARANTINED");
    expect(result.evidence.cleanupNote).toContain(QUARANTINE_SUFFIX);
  });

  it("reports the exact path when neither deletion nor quarantine works", async () => {
    const { result } = await run({}, { removeFails: true, quarantineFails: true });
    expect(result.evidence.cleanup).toBe("CLEANUP_FAILED");
    expect(result.evidence.cleanupNote).toContain(DISPOSABLE_FILENAME_MARKER);
    expect(result.evidence.cleanupNote).toContain("remove it yourself");
  });
});

describe("withDisposableProject - protected files must not change", () => {
  it("fails closed when the immutable source changed during the inspection", async () => {
    const { result } = await run({}, { hashesAfter: { [TARGET]: "f".repeat(64) } });
    expect(result.ok === false && result.code).toBe("PROTECTED_FILE_CHANGED");
    expect(result.ok === false && result.reason).toContain("safety violation");
    expect(result.evidence.sourceSha256After).toBe("f".repeat(64));
  });

  it("fails closed when the session working copy changed during the inspection", async () => {
    const { result } = await run(
      {},
      { hashes: { [WORKING]: WORKING_SHA }, hashesAfter: { [WORKING]: "0".repeat(64) } },
      { workingProjectPath: WORKING, workingProjectSha256: WORKING_SHA }
    );
    expect(result.ok === false && result.code).toBe("PROTECTED_FILE_CHANGED");
    expect(result.ok === false && result.reason).toContain("session working copy changed");
  });

  it("cleans up even when it fails closed on a changed protected file", async () => {
    const { result, fs } = await run({}, { hashesAfter: { [TARGET]: "f".repeat(64) } });
    expect(fs.removed).toHaveLength(1);
    expect(result.evidence.cleanup).toBe("DELETED");
  });
});

describe("withDisposableProject - Windows path handling", () => {
  it("accepts After Effects reporting the same path with different separators and casing", async () => {
    const { result } = await run({ opensInstead: undefined });
    expect(result.ok).toBe(true);

    // AE frequently reports forward slashes; the comparison must not care.
    const ae = fakeAe();
    const wrapped = {
      ...ae,
      run: async (script: string) => {
        const outcome = await ae.run(script);
        if (outcome.ok && typeof outcome.value === "object" && outcome.value !== null && "resultingValue" in outcome.value) {
          const inner = (outcome.value as { resultingValue: { openedPath?: unknown } }).resultingValue;
          if (typeof inner.openedPath === "string") {
            inner.openedPath = inner.openedPath.replace(/\\/g, "/").toUpperCase();
          }
        }
        return outcome;
      }
    };
    const fs = fakeFs();
    const normalisedResult = await withDisposableProject(
      { runScript: wrapped.run as never, fileOps: fs.fileOps, lock: new ProjectStateLock(() => NOW), now: () => NOW },
      request(),
      async () => "inspected"
    );
    expect(normalisedResult.ok).toBe(true);
  });
});
