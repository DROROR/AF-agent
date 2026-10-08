import { describe, expect, it } from "vitest";
import { BridgeHold } from "./bridge-hold.js";

describe("BridgeHold - a job and the health probe never use the bridge at once", () => {
  it("is not held when nothing runs", () => {
    expect(new BridgeHold().isHeld()).toBe(false);
  });

  it("is held from before the running probe is waited for until the work has ended", async () => {
    const hold = new BridgeHold();
    const seen: string[] = [];
    let releaseProbe!: () => void;
    const probe = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });

    const running = hold.run(
      async () => {
        seen.push(`waiting-for-probe held=${hold.isHeld()}`);
        await probe;
      },
      async () => {
        seen.push(`work held=${hold.isHeld()}`);
        return "done";
      }
    );

    // The flag is already up while the probe is still being waited for, so no new probe can start in that gap.
    await Promise.resolve();
    expect(hold.isHeld()).toBe(true);
    expect(seen).toEqual(["waiting-for-probe held=true"]);

    releaseProbe();
    await expect(running).resolves.toBe("done");
    expect(seen).toEqual(["waiting-for-probe held=true", "work held=true"]);
    expect(hold.isHeld()).toBe(false);
  });

  it("releases the hold when the work throws", async () => {
    const hold = new BridgeHold();
    await expect(hold.run(async () => undefined, async () => Promise.reject(new Error("AE said no")))).rejects.toThrow("AE said no");
    expect(hold.isHeld()).toBe(false);
  });

  it("stays held until the last of two overlapping holders has ended", async () => {
    const hold = new BridgeHold();
    let endFirst!: () => void;
    const first = hold.run(async () => undefined, () => new Promise<void>((resolve) => { endFirst = resolve; }));
    await hold.run(async () => undefined, async () => undefined);
    expect(hold.isHeld()).toBe(true);
    endFirst();
    await first;
    expect(hold.isHeld()).toBe(false);
  });
});
