#!/usr/bin/env node
// Presentation-only helper for the Windows deployment package. Reads the
// real DYO Worker's own JSON log lines (pino, written to stdout) from
// stdin and prints a short, non-technical line for each recognized event.
// Run as: node dist/index.js | node dist/format-status.js
//
// This never touches apps/worker's own source or logging behavior - it is
// copied verbatim into deploy/windows-worker/worker-app/dist/ by
// scripts/package-windows-worker.mjs. Any field whose name contains
// "token" or "secret" is stripped before printing, as a second layer of
// protection on top of the worker's own redaction (apps/api and
// apps/worker already never log WORKER_TOKEN/WORKER_REGISTRATION_SECRET).
import { createInterface } from "node:readline";

const SENSITIVE_KEY_PATTERN = /token|secret/i;

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[hidden]" : redact(val);
    }
    return out;
  }
  return value;
}

function statusLine(entry) {
  const msg = typeof entry.msg === "string" ? entry.msg : "";

  if (msg === "worker starting") {
    return "Connecting to DYO...";
  }
  if (
    msg === "Using pre-provisioned worker credentials from the environment" ||
    msg === "Using persisted worker credentials from a prior pairing" ||
    msg === "Registered with the API and persisted issued credentials"
  ) {
    return "[OK] Worker registered and authenticated with DYO.";
  }
  if (msg === "heartbeat succeeded") {
    const ae = entry.aeStatus ?? "Unknown";
    const mcp = entry.mcpStatus ?? "Unknown";
    return `[OK] Connected. Heartbeat active. After Effects: ${ae} | ae-mcp: ${mcp}`;
  }
  if (msg === "heartbeat failed, will retry") {
    return "[WARN] Lost connection to DYO - retrying automatically. No action needed unless this repeats for several minutes.";
  }
  if (msg === "received shutdown signal") {
    return "Stopping DYO Worker...";
  }
  if (msg === "heartbeat loop stopped" || msg === "Shutdown complete") {
    return "DYO Worker stopped.";
  }
  return null;
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    // Not a JSON log line (e.g. a stack trace) - show it as-is, with the
    // same defensive keyword check applied to the raw text.
    console.log(SENSITIVE_KEY_PATTERN.test(trimmed) ? "[a line was hidden for safety]" : trimmed);
    return;
  }

  const safeEntry = redact(entry);
  const friendly = statusLine(safeEntry);
  if (friendly) {
    console.log(friendly);
  } else if (typeof safeEntry.level === "number" && safeEntry.level >= 50) {
    // pino level 50+ = error/fatal - always surface unrecognized errors,
    // never silently swallow them.
    console.log(`[ERROR] ${safeEntry.msg ?? "unknown error"}`);
  }
});
