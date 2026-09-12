import { describe, expect, it, vi } from "vitest";
import { AeBridgeReconnector, DEFAULT_MAX_RECONNECT_ATTEMPTS } from "./reconnect-ae-bridge.js";

function makeReconnector(
  callReconnect = vi.fn().mockResolvedValue({ ok: true, detail: "bridge re-registered" }),
  startAt = 1_000_000
) {
  let clock = startAt;
  const reconnector = new AeBridgeReconnector({
    callReconnect,
    now: () => clock,
    cooldownMs: 120_000,
    maxAttempts: 3,
    logger: { info: vi.fn(), warn: vi.fn() }
  });
  return { reconnector, callReconnect, advance: (ms: number) => (clock += ms) };
}

describe("AeBridgeReconnector", () => {
  it("attempts ae_reconnect on a confirmed bridge-not-connected", async () => {
    const { reconnector, callReconnect } = makeReconnector();
    const outcome = await reconnector.reconnect();

    expect(outcome.action).toBe("reconnected");
    expect(outcome.attempt).toBe(1);
    expect(callReconnect).toHaveBeenCalledTimes(1);
  });

  it("refuses a second attempt inside the cooldown window", async () => {
    const { reconnector, callReconnect, advance } = makeReconnector();
    await reconnector.reconnect();

    advance(30_000);
    const outcome = await reconnector.reconnect();

    expect(outcome.action).toBe("cooling-down");
    expect(outcome.detail).toMatch(/90s/);
    expect(callReconnect).toHaveBeenCalledTimes(1);
  });

  it("attempts again once the cooldown has elapsed", async () => {
    const { reconnector, callReconnect, advance } = makeReconnector();
    await reconnector.reconnect();
    advance(120_001);
    await reconnector.reconnect();

    expect(callReconnect).toHaveBeenCalledTimes(2);
  });

  // The exact 2026-09-12 shape: AE running, bootstrap never loaded. No number
  // of reconnects fixes that, so the budget must end in an actionable state.
  it("BLOCKS after the bounded budget and names the exact operator action", async () => {
    const { reconnector, callReconnect, advance } = makeReconnector(
      vi.fn().mockResolvedValue({ ok: false, detail: "no live bridge heartbeat" })
    );

    for (let i = 0; i < 3; i += 1) {
      await reconnector.reconnect();
      advance(120_001);
    }
    const outcome = await reconnector.reconnect();

    expect(outcome.action).toBe("blocked");
    expect(outcome.detail).toContain("OPERATOR ACTION");
    expect(outcome.detail).toContain("fully quit and reopen After Effects");
    expect(callReconnect).toHaveBeenCalledTimes(DEFAULT_MAX_RECONNECT_ATTEMPTS);
  });

  it("never retries forever - the call count stays capped however often it is asked", async () => {
    const { reconnector, callReconnect, advance } = makeReconnector(
      vi.fn().mockResolvedValue({ ok: false, detail: "still down" })
    );
    for (let i = 0; i < 25; i += 1) {
      await reconnector.reconnect();
      advance(120_001);
    }
    expect(callReconnect).toHaveBeenCalledTimes(3);
  });

  it("resets its budget once the bridge is confirmed connected again", async () => {
    const { reconnector, callReconnect, advance } = makeReconnector(
      vi.fn().mockResolvedValue({ ok: false, detail: "down" })
    );
    for (let i = 0; i < 3; i += 1) {
      await reconnector.reconnect();
      advance(120_001);
    }
    expect((await reconnector.reconnect()).action).toBe("blocked");

    reconnector.noteBridgeConnected();

    expect((await reconnector.reconnect()).action).not.toBe("blocked");
    expect(callReconnect).toHaveBeenCalledTimes(4);
  });

  it("reports a throwing reconnect as attempt-failed rather than crashing the probe", async () => {
    const { reconnector } = makeReconnector(vi.fn().mockRejectedValue(new Error("stdio closed")));
    const outcome = await reconnector.reconnect();

    expect(outcome.action).toBe("attempt-failed");
    expect(outcome.detail).toBe("stdio closed");
  });

  it("counts a throwing attempt against the budget, so a permanently broken bridge still terminates", async () => {
    const { reconnector, advance } = makeReconnector(vi.fn().mockRejectedValue(new Error("stdio closed")));
    for (let i = 0; i < 3; i += 1) {
      await reconnector.reconnect();
      advance(120_001);
    }
    expect((await reconnector.reconnect()).action).toBe("blocked");
  });

  // A successful ae_reconnect CALL is not the same as a connected bridge.
  // Only the next real probe is evidence, so this must never imply ONLINE.
  it("does not claim the bridge is up - only that the call reported success", async () => {
    const { reconnector } = makeReconnector();
    const outcome = await reconnector.reconnect();
    expect(outcome.action).toBe("reconnected");
    expect(outcome.action).not.toBe("not-needed");
  });
});
