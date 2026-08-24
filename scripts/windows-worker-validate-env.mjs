#!/usr/bin/env node
// Proves what Node itself sees via `node --env-file=.env`, not what
// PowerShell's Get-Content sees. Those two can disagree about the exact
// same bytes on disk: PowerShell's file-reading is BOM-transparent
// (silently strips a leading UTF-8 byte-order mark), while Node's
// --env-file parser is not - a BOM becomes part of the first key it
// parses, silently breaking only the first variable declared in the file.
// A real client hit exactly this (DYO_API_URL, the first line, undefined;
// every later variable loaded fine) while a PowerShell-side check reported
// the file complete.
//
// Run as: node --env-file=.env dist\validate-env.js KEY1 KEY2 ...
// Prints only key NAMES, never values. Exit 0 = all present and non-empty;
// exit 1 = at least one missing/empty (names on stderr); exit 2 = no keys
// were given to check at all (a caller bug, not a config problem).
const requiredKeys = process.argv.slice(2);

if (requiredKeys.length === 0) {
  console.error("MISSING_ARGS: no keys were given to validate");
  process.exit(2);
}

const missing = requiredKeys.filter((key) => {
  const value = process.env[key];
  return value === undefined || value.trim() === "";
});

if (missing.length > 0) {
  console.error(`MISSING:${missing.join(",")}`);
  process.exit(1);
}

console.log("OK");
process.exit(0);
