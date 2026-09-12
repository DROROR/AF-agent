import { describe, expect, it } from "vitest";
import { listDyoProcessesViaCim, normalizeCimDate, parseCimProcessJson } from "./list-dyo-processes.js";

// Captured from the real FAHADNAKASH process table shape (2026-09-12 incident).
const REAL_OUTPUT = JSON.stringify([
  {
    ProcessId: 23884,
    ParentProcessId: 7412,
    Name: "node.exe",
    CommandLine: "node dist\\supervisor\\index.js",
    CreationDate: "/Date(1789222160000)/"
  },
  {
    ProcessId: 17608,
    ParentProcessId: 23884,
    Name: "node.exe",
    CommandLine: "node --env-file=.env dist\\index.js",
    CreationDate: "/Date(1789222168000)/"
  },
  { ProcessId: 9100, ParentProcessId: 1, Name: "AfterFX.exe", CommandLine: null, CreationDate: null }
]);

describe("parseCimProcessJson", () => {
  it("parses a real multi-process capture", () => {
    const records = parseCimProcessJson(REAL_OUTPUT);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ processId: 23884, parentProcessId: 7412, name: "node.exe" });
    expect(records[2]?.commandLine).toBeNull();
  });

  it("handles the SINGLE-process case, where ConvertTo-Json emits a bare object not an array", () => {
    const single = JSON.stringify({ ProcessId: 17608, ParentProcessId: 23884, Name: "node.exe", CommandLine: "x" });
    expect(parseCimProcessJson(single)).toHaveLength(1);
  });

  it("returns an empty list for empty output rather than throwing", () => {
    expect(parseCimProcessJson("")).toEqual([]);
    expect(parseCimProcessJson("   \n ")).toEqual([]);
  });

  it("returns an empty list for non-JSON output rather than throwing", () => {
    expect(parseCimProcessJson("Get-CimInstance : Access is denied.")).toEqual([]);
  });

  it("skips malformed entries instead of inventing fields", () => {
    const mixed = JSON.stringify([{ ProcessId: "not-a-number", Name: "node.exe" }, { ProcessId: 1, Name: "node.exe" }]);
    expect(parseCimProcessJson(mixed)).toHaveLength(1);
  });

  it("caps the number of records returned", () => {
    const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ ProcessId: i + 1, Name: "node.exe" })));
    expect(parseCimProcessJson(many).length).toBeLessThanOrEqual(100);
  });
});

describe("normalizeCimDate", () => {
  it("parses a .NET serialized date", () => {
    expect(normalizeCimDate("/Date(1789222168000)/")).toBe("2026-09-12T14:09:28.000Z");
  });

  it("parses a CIM_DATETIME string", () => {
    expect(normalizeCimDate("20260912140928.000000+000")).toBe("2026-09-12T14:09:28.000Z");
  });

  it("returns null - never a guessed timestamp - for an unrecognized value", () => {
    expect(normalizeCimDate("not a date")).toBeNull();
    expect(normalizeCimDate(null)).toBeNull();
  });
});

describe("listDyoProcessesViaCim", () => {
  it("uses a FIXED command with no interpolated input", async () => {
    let capturedArgs: string[] = [];
    await listDyoProcessesViaCim(async (args) => {
      capturedArgs = args;
      return REAL_OUTPUT;
    }, "win32");
    const command = capturedArgs.join(" ");
    expect(command).toContain("Get-CimInstance Win32_Process");
    expect(command).toContain("-NonInteractive");
    // No shell metacharacter could reach here because no caller value does.
    expect(command).not.toContain("&&");
    expect(command).not.toContain(";powershell");
  });

  it("returns the real parsed records on Windows", async () => {
    const records = await listDyoProcessesViaCim(async () => REAL_OUTPUT, "win32");
    expect(records.map((record) => record.processId)).toEqual([23884, 17608, 9100]);
  });

  it("THROWS on a non-Windows platform rather than reporting an empty process list", async () => {
    // An empty list would read as "nothing is running", which is a false
    // negative - the caller turns this throw into an explicit ok:false.
    await expect(listDyoProcessesViaCim(async () => "", "linux")).rejects.toThrow(/Windows only/);
  });
});
