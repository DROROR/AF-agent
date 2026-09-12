# MVP Acceptance Criteria — Status Tracker

MVP is accepted only when every row below is IMPLEMENTED and REAL-HARDWARE
proof exists for the hardware-dependent rows (see `evals/` for the
per-template checklist that supplies that proof). This file is a live
tracker, not just a spec - update a row's status only when the real
evidence named actually exists; a docs mention of a feature is never
itself "done".

**Status legend:** IMPLEMENTED (real, tested code) · PARTIAL (real but
incomplete, see note) · REAL-HARDWARE-PROOF-PENDING (code is real/tested
against fakes, never yet run against the real Windows/AE machine) ·
MISSING (no real implementing code).

Last updated: 2026-09-12.

## Three-template validation
| Criterion | Status | Evidence |
|---|---|---|
| Complete workflow run on three different plugin-free templates | BLOCKED - NO PLUGIN-FREE TEMPLATE AVAILABLE | `evals/README.md` + `evals/template-case.template.json` track this; zero qualifying runs completed. **Blocker as of 2026-09-11: every `.aep` available on the QA machine is Element 3D-dependent, so none can count toward this criterion.** See "Plugin-dependency findings" below. Supplying at least one genuinely different, plugin-free `.aep` on FAHADNAKASH is now the single unavoidable external input this criterion is waiting on - it cannot be satisfied by any further engineering |

### Plugin-dependency findings (2026-09-11, real evidence)

Both `.aep` files available on the QA machine (FAHADNAKASH) are proven
Element 3D-dependent and **must not count toward the three plugin-free
templates** above. Neither file was modified; both remain byte-identical
to their recorded hashes (every check ran against a disposable scratch
copy).

| File | SHA256 | Finding |
|---|---|---|
| `dro-template-converted.aep` (project `t`) | `67e1b708...` | The engagement's canonical source. `comp-1600` layer "Element 3D" carries `VIDEOCOPILOT 3DArray`; no `Element*.aex` exists anywhere on the machine, so it renders as a pink "missing effect" frame - the proven cause of the black hard cut at Scene 1 local ~2.612s. Confirmed by an A/B render (layer enabled = pink error frame, disabled = solid black). |
| `dro tempelate.aep` → `dro-tempelate-converted-v26.aep` | `47de85ca...` → `c6c27aa7...` | A different file, but the same dependency. Authored in AE 23.2.1, required an interactive version-conversion dialog to open (fixed generically - see `legacy-project-conversion.ts`). A full project-wide scan of the converted copy found **18 enabled `VIDEOCOPILOT 3DArray` instances across 11 compositions** (phone, phone xxx, phoneee, phpone xxxzz, Pre-comp 1, Pre-comp 2, Pre-comp 4, Scene 4, Scene 7, Scene 8, Scene 9) out of 83 project items / 25 compositions carrying effects. Also has unresolvable fonts (Evolventa-Bold/Regular) and 2 expression errors. Appears to be an older variant of the same template. |

An exhaustive read-only search of FAHADNAKASH (2026-09-11, excluding
session working copies, auto-saves and diagnostic scratch files) found
exactly four `.aep` files: the three above, plus
`dro-template-converted.CORRUPTED-20260908.aep` (`f52e07b0...`, explicitly
marked corrupted, never opened or scanned). **No plugin-free `.aep`
exists on the QA machine** - objectively confirmed, not an assumption.

Resolution options for the Element 3D dependency itself (separate from
the acceptance blocker above): install a genuine licensed Element 3D on
the render machine, or replace the dependent design. Pending client
confirmation of whether they already own a license.

### Supplying a new template (what a usable package must contain)

Destination on FAHADNAKASH: **`C:\DYO-Agent\copies\<template-name>\`**
(one subfolder per template, keeping the template's own original folder
layout intact). Never place a template in `execution-sessions\`,
`template-conversions\`, `diagnostics-scratch\`, or any `Auto-Save`
folder - those are machine-managed, excluded from searches, and
overwritten without warning.

Required:
1. **The `.aep` itself** - must use no third-party plugin effects. This is
   now verified automatically at inspection (every effect's matchName must
   be `ADBE `-prefixed); no human pre-check needed.
2. **Its linked footage/assets**, copied with the same relative layout the
   project expects (typically a sibling `(Footage)` folder). Missing
   footage is now detected and reported from AE's own `footageMissing`
   flag, but the run cannot produce correct video without the real files.
3. **Its font list**, and those fonts installed on FAHADNAKASH. The
   manifest now reports which fonts a project asks for, but AE exposes no
   "is this installed here" flag, so availability remains a human check -
   an Envato help/readme file listing them is the practical input.

Preferred but not required:
4. **Saved from AE 2026 (26.3x87).** An older-version project still works -
   the conversion requirement is detected generically and a disposable
   copy is prepared automatically - but it costs one manual
   convert-and-Save-As round trip that an AE 2026-saved file avoids.
5. **Real, separable scene structure**: distinct scene compositions with
   named text/media placeholder layers. Independent of plugins, a template
   whose layers carry no recognisable placeholders yields
   `editablePlaceholderCount: 0` and cannot exercise the mapping/approval
   stages this acceptance criterion is meant to prove.

Not needed: no license keys, no plugin installs, no Creative Cloud extras,
no pre-conversion, no particular composition naming convention.

**`preflight.pluginReferences` was an empty stub until this incident** and
a real operator read `pluginReferenceCount: 0` as proof of plugin-free
status while the template was Element 3D-dependent throughout. It is now
populated from a real project-wide effect scan, and a failed scan is
surfaced as an explicit `unknownItems` warning rather than looking like
zero - see `parse-project-effects-scan.ts`.

## Startup & recovery acceptance (2026-09-12)

Release blocker raised 2026-09-12: after every Windows restart a human had
to open After Effects and click CONNECT in the ae-mcp panel before any job
could run. Treated as a startup/recovery defect, not an operator procedure.

| Criterion | Status | Evidence |
|---|---|---|
| Worker starts automatically at Windows startup/login | IMPLEMENTED (pre-existing, verified) | `DYO-Worker-Setup.ps1:508` registers the Scheduled Task `-AtLogOn` with `-StartWhenAvailable`, `RestartCount 999`, 1-minute retry, unlimited execution time. **Known constraint:** `LogonType Interactive` was chosen so the Windows password is never stored, so this requires an actual login - it will not start at a locked login screen. Unattended reboots need Windows auto-login configured on the machine. |
| Worker starts/reconnects AE automatically when a job needs it | IMPLEMENTED, REAL-HARDWARE-PROOF-PENDING | `apps/worker/src/health/ensure-ae-running.ts` + `launch-ae.ts`, invoked from the heartbeat so a cold machine settles without any job. 8 tests incl. cold boot, delayed startup, no duplicate instance, no launch on an inconclusive check. |
| MCP probe does a real bounded round trip, never a false UNKNOWN | IMPLEMENTED, REAL-HARDWARE-PROOF-PENDING | `apps/worker/src/health/ae-mcp-round-trip-adapter.ts` - calls the allowlisted read-only `ae_health` tool and parses its confirmed shape. Replaces an exit-code probe with a hard 8s ceiling that reported a genuinely LISTENING/CONNECTED bridge as UNKNOWN every 15s indefinitely, blocking all dispatch. 11 tests incl. slow-but-healthy bridge, disconnect/reconnect, probe timeout, no false ONLINE. |
| Bounded self-recovery, no endless loops, no false ONLINE | IMPLEMENTED | Launcher: one attempt per cooldown, capped total, then an explicit actionable blocked reason; budget resets once AE is seen healthy. Probe: bounded backed-off retries, ONLINE only on a real parsed `connected: true`. |
| Genuine AE modal/user-interaction produces an explicit blocked state | IMPLEMENTED | `EnsureAeRunningOutcome.blocked` names the real human causes (licensing/sign-in prompt, blocking dialog) rather than retrying. |
| Worker identity / `.env` / client job history untouched | IMPLEMENTED | Enforced by regression tests in `scripts/windows-worker/__tests__/dyo-worker-startuprecovery-update.test.ts`; see `CLIENT_WORKER_UPDATE_PROCEDURE.md` for the per-item guarantee table. |
| Packaged with rollback | IMPLEMENTED | Backs up `dist` **and** `BUILD_INFO.json` together, proves the new files landed before restarting, polls up to 120s for one supervisor plus a real worker child, restores and restarts automatically on failure. |
| **Real cold-reboot acceptance on FAHADNAKASH** | **PENDING** | Deferred by the operator on 2026-09-12 (machine in use). Must show: reboot, log in, do not open AE or touch the ae-mcp panel, all three settle to ONLINE unaided, then a successful CHECK_HEALTH and a real job. |

### Worker health/startup defects found and fixed on real hardware (2026-09-12)

Every row below was found by a REAL failure on FAHADNAKASH, not by review.
Several were regressions I introduced while fixing the row above them; they
are listed because the pattern matters more than any single bug: a health
check must never be able to block the worker, and an unreliable measurement
must never be reported as a changed state.

| Defect | Real symptom | Fix | Regression test |
|---|---|---|---|
| MCP probe judged the bridge by a CLI exit code under a hard 8s ceiling | A genuinely LISTENING/CONNECTED bridge reported UNKNOWN every 15s, blocking every dispatch | Real MCP round trip (`ae_health`), realistic bounded budget, bounded retries | slow-but-healthy bridge still ONLINE |
| Health parser required a nested `health` object | `unrecognized-health-shape` against a live bridge | Accept either location; still requires an EXPLICIT boolean, so false ONLINE stays impossible | verbatim captured FAHADNAKASH response |
| Heartbeat AWAITED the MCP probe | Worker logged "worker starting" then went silent; never registered | `checkHealth()` never blocks; background refresh; hard wall-clock deadline; owned ae-mcp child force-terminated on expiry | client whose `connect()` never settles |
| Startup AWAITED abandoned-job reconciliation | Same silence whenever `/jobs/active` was briefly unreachable (the API itself returned 200) | Loop starts first; reconciliation runs independently; its failure is logged and changes nothing | — |
| Raised `tasklist` timeout + added retry | **Self-inflicted:** a hanging `tasklist` stalled the heartbeat path; worker heartbeated once then went silent | Hard 2.5s per-attempt deadline independent of `execFile`'s own timeout | runner that never settles |
| A failed probe overwrote a good state | `mcpStatus` oscillated UNKNOWN → ONLINE → UNKNOWN, and `aeStatus` dropped to UNKNOWN, while both were up throughout | Consecutive-failure debounce before downgrading a confirmed ONLINE (reported as `holding(n/3)`); widened reuse windows. An explicit OFFLINE is real evidence and is never debounced | hold, downgrade, and never-debounce-OFFLINE cases |

**Honesty note on process:** an earlier build was called "stable" on the
basis of an eight-sample window, and a package hash was once emitted from a
build with a failing test. Neither is an acceptable standard of evidence.
Stability claims here require a sustained sample and a fully green suite.

### Installer defects found and fixed while proving this (2026-09-12)

Five defects in the update tooling itself, each found by a real failed
install on FAHADNAKASH and each now pinned by a regression test. Recorded
because they were mistakes in the delivery tooling, not in the product, and
the distinction matters for anyone reading this history later.

| Defect | Symptom | Fix |
|---|---|---|
| Over-broad process match (`dist\index.js`) | Update killed the ae-mcp bridge; MCP reported OFFLINE right after installing | Match `--env-file=.env dist\index.js`, the worker child's distinctive form, which ae-mcp's command line cannot match |
| Files replaced while the Worker still ran | Install fought a live process | Stop, and positively verify exit, before touching any file; abort changing nothing if it cannot |
| Fixed 5s sleep used as the health verdict | False rollback - the supervisor starts before its child | Poll up to 120s for one supervisor plus a real worker child |
| `return @()` unrolled to `$null` | `$null.Count` is `$null`, so the health check could never pass; forced rollback regardless of whether the build worked, and printed empty counts | Comma operator on return plus `@( )` at every call site |
| Rollback restored `dist` but not `BUILD_INFO.json` | Old code logging the new commit - the log misidentified which build was running | Back up and restore both together |
| PID matched without identity | Windows recycled a PID; installer tried to terminate PID 188, a child of PID 4 (System) | Re-verify at kill time: PID + creation time + `node.exe` + this worker's command lines, behind a hard PID<=4 floor |

## Source safety
| Criterion | Status | Evidence |
|---|---|---|
| Original `.aep` hash unchanged | IMPLEMENTED | `apps/worker/src/inspection/hash-source-project.ts`, re-verified before/after in `execute-scene-edit-executor.ts` |
| Source media not modified | IMPLEMENTED | edits only ever touch the session's own working copy (`workspace/working-copy.ts`) |

## Mapping/execution
| Criterion | Status | Evidence |
|---|---|---|
| Only selected scenes included | IMPLEMENTED | `use: false` scenes excluded from dispatch, tested |
| Final order matches approved plan | IMPLEMENTED | `finalOrder` field, tested |
| Placeholders map to correct assets | IMPLEMENTED | `resolve-execute-frame-dispatch.ts`, tested |
| Text/No Text respected | IMPLEMENTED | `SET_TEXT` derived only from the approved mapping's own text |
| Final duration respected | IMPLEMENTED | `finalDuration`/`layerDurationSeconds`, tested |
| Exact video timestamp within one source frame | REAL-HARDWARE-PROOF-PENDING | `assetTimestamp` is carried end-to-end; frame-exact extraction accuracy has not been verified against a real source video on real hardware |

## Visual proof
| Criterion | Status | Evidence |
|---|---|---|
| Actual preview images captured from exact output comp | IMPLEMENTED | `apps/worker/src/execution/preview-capture.ts`, uploaded via `upload-preview.ts`, tested |
| First-frame approval flow works | IMPLEMENTED | execution session preview approve/reject, dashboard-wired |
| Branding approval flow works | PARTIAL | brand rules are enforced as a hard gate at plan APPROVAL (`approve-execution-plan.ts` + `dyo-brand-rules.yaml`) - there is no SEPARATE dedicated "branding approval" stage distinct from plan approval (see `docs/MASTER_PLAN.md` section 7's own status note on why) |
| Final preview approval works | IMPLEMENTED | execution session preview approve/reject |

## Branding
| Criterion | Status | Evidence |
|---|---|---|
| Client/company logo at least once | IMPLEMENTED | `dyo-brand-rules.yaml` + `validate-brand-rules.ts`, hard-blocks plan approval, tested |
| Hebrew `מבית DYO App` present | IMPLEMENTED | same gate as above, tested |
| Official DYO blue used from approved config | PARTIAL | enforcement code is real and tested (`validate-brand-rules.ts`'s `DYO_BLUE_USAGE` check), but the real canonical hex has not yet been supplied by the client - `dyo-brand-rules.yaml`'s `dyoBlueHex` is `null`, so this specific rule is not yet active (see that file's own doc comment) |
| Client screenshots/logos/phone hardware not unintentionally recolored | IMPLEMENTED | `SET_BRAND_COLOR` only ever targets a mapping explicitly classified `"color"` - never a blanket recolor |

## Outputs
| Criterion | Status | Evidence |
|---|---|---|
| Landscape output correct | REAL-HARDWARE-PROOF-PENDING | full 4-stage render pipeline real and tested against a simulated `aerender`; never run against real AE 2026 |
| Native 1080x1920 Reels output correct | REAL-HARDWARE-PROOF-PENDING | `BUILD_REELS_COMPOSITION` (schema/JSX/dispatch/checkpoint, all tested against fakes) builds a real, repositioned 1080x1920 duplicate composition, and `register-reels-composition.ts` registers it as an additive derived entry on the project's manifest the moment the job succeeds - immediately selectable from the existing Render Settings dropdown and resolvable by RENDER REELS through the existing, unmodified render-dispatch pipeline, no manual step. Fails closed (never registers) if the plan/session/working-copy-SHA has gone stale since dispatch. Fully tested against fakes; never yet run on real AE 2026 |
| Reels layout is repositioned, not merely cropped | IMPLEMENTED (by construction) | `jsx-templates.ts`'s `buildBuildReelsCompositionScript` duplicates (never crops) and repositions named layers to explicit human-approved coordinates, refusing to overwrite a layer with existing keyframe animation |
| Every JSX script's `JSON.stringify` calls work at real ExtendScript runtime | IMPLEMENTED (2026-09-02) | Real production failure on the first client-machine run: `INSPECT_RENDER_CAPABILITIES -> TOOL_ERROR / AE_ERROR: "JSON is undefined"` - ExtendScript has no native `JSON` global. A fixed, reviewed `JSON.stringify`-only shim (`JSON_STRINGIFY_POLYFILL`) is now prepended to every script `jsx-templates.ts` builds (installed only if a real one isn't already present). Reproduced and proven fixed via a `node:vm` sandbox with `JSON` explicitly undefined, invoked the same way the real `ae_run_jsx` tool does - not yet re-run against the real client machine (the client-machine Worker update itself remains blocked on a separate MCP-health investigation, unrelated to this fix) |

## Reliability
| Criterion | Status | Evidence |
|---|---|---|
| Worker heartbeat visible | IMPLEMENTED | Workers page, live |
| MCP disconnect detected | PARTIAL | no distinct `MCP_DISCONNECTED` state - represented via `mcpStatus: "OFFLINE"`, which safely gates every ae-mcp-dependent dispatch closed (never hangs, never silently proceeds) |
| AE heartbeat/modal problem produces safe pause | IMPLEMENTED | `classify-mcp-failure.ts` classifies a genuine timeout as `AE_UNRESPONSIVE (BRIDGE_TIMEOUT)` with an honest "NEEDS HUMAN ACTION" message (no claimed dedicated modal detection); the executor stops at the failed operation, never attempts the next one, and preserves the checkpoint |
| At least one interrupted job resumes successfully | IMPLEMENTED (real-hardware proof pending) | `resolve-resume-checkpoint.ts` carries a prior FAILED attempt's own durable checkpoint into a fresh dispatch for the same scene/render variant, tested against fakes; never yet proven against a genuinely killed real worker process on real hardware |
| Render is separate and recoverable | IMPLEMENTED | RENDER is its own operation, own 4-stage checkpoint, reuses the same true-resume mechanism as EXECUTE_FRAME |

## Corrections
One creative/design correction round is included in the workflow. Technical
bugs are fixed until these acceptance criteria pass and do not consume the
creative correction round.
