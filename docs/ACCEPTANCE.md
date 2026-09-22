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

## 2026-09-12 — silent-worker incident, remote diagnostics, and the release gate

See `docs/INCIDENT-2026-09-12-worker-silent.md` for the full timeline and evidence.

| Requirement | Status | Evidence |
|---|---|---|
| Root cause of the silent worker identified | PASS | `HeartbeatLoop.tick()` re-armed its timer only after its awaits settled; API received zero requests from `accd0a71` for ~50 min while a second worker heartbeated normally throughout |
| Heartbeat can survive a non-settling await | PASS (code) | `withDeadline` + unconditional reschedule; 3 regression tests fail against the previous implementation |
| Job claim bounded | PASS (code) | `CLAIM_DEADLINE_MS` in `apps/worker/src/index.ts` |
| Root cause of the failed inspections identified | PASS | `ae_health` in job `48bf41d3`: `projectOpen: true, projectPath: null, projectName: "Untitled", numItems: 46` → modal save-changes prompt → `system.runJsx` timeout at 30s |
| Inspection reports an actionable blocked state instead of an opaque failure | PASS (code) | `assess-unsaved-project-block.ts`, 9 tests |
| Both incident job records reconciled | PASS | `48bf41d3` FAILED (terminal, real cause); `df76c2be` CANCELLED transactionally at 14:35:35Z with a structured reason |
| A stuck QUEUED job can be cancelled without hand-editing the database | PASS (code) | `POST /api/jobs/:jobId/cancel`, QUEUED-only, 6 tests |
| Remote diagnostics over the existing outbound channel | PASS (code) | `RUN_DIAGNOSTIC` (7 read-only kinds) + `RESTART_WORKER_SAFE`; no inbound port, no shell, no caller-supplied path |
| Secrets redacted before leaving the worker | PASS | 21 redaction tests, including a Bearer-token hole the tests themselves caught |
| Diagnostic reads confined to the work root | PASS | `confine-path.ts`, 7 tests incl. the sibling-prefix case a string check would allow |
| Safe restart cannot create a duplicate tree or change identity | PASS | Spawns nothing; exits so the existing supervisor starts one replacement; 7 tests |
| Diagnostics rate-limited and audited | PASS | Limits read from the jobs table (survive an API restart); explicit `audit:` log lines |
| Worker newer than API degrades rather than going offline | PASS | Unknown capabilities dropped, not rejected; 6 tests. **Found while packaging — would have bricked FAHADNAKASH.** |
| Release payload verified from inside the ZIP | PASS | 10 content assertions; archive proven not byte-identical to the prior release |
| Full suite / lint / typecheck | PASS | 3481 tests in 295 files; eslint clean; `tsc -b tsconfig.solution.json` exit 0 |
| **API + web deployed** | **BLOCKED** | Deploy denied by the environment's auto-mode classifier. Must precede the worker install. |
| **Worker update installed on FAHADNAKASH** | **BLOCKED** | Requires the operator to run the installer, and requires the API deploy first |
| Mixkit `App_Promo.aep` inspection end-to-end | BLOCKED | Blocked behind the two rows above, and behind the operator clearing AE's unsaved `Untitled` project |
| Full template workflow (mapping → plan → render → recovery) | NOT STARTED | Blocked behind a successful inspection |
| Cold-reboot acceptance | NOT RUN | Requires the new build installed first |
| Three plugin-free templates | BLOCKED | Both supplied QA templates are Element 3D dependent; a third has never been supplied |

### Deployment order is a hard gate

1. Deploy API/web at `83ec9b9`.
2. Only then install the worker update.

Reversing this against the **currently deployed** API 400s every heartbeat and
takes the worker permanently offline. After this release is deployed the order
no longer matters — that is exactly what the forward-compatibility fix buys.

## 2026-09-13 - nested-composition manifest traversal

Status: **deployed (API + worker `c1245b4`) and re-inspected - structural validation PASSED. Semantic placeholder review still open (see below).**

Problem (job `5441c555`, plugin-free Mixkit template): 21 compositions, ~96 layers, **1** placeholder
(`CONTROLS`), because the scene's other layers are precomp references and nothing below them was examined.

What changed:
- Recursive descent through precomp references, full `layerPath`, and a machine-usable `nestedTarget`
  chain with the exact semantics the worker's nested JSX walker verifies per hop.
- Cycle guard, 20-level depth guard, un-inspected-child reporting - all surfaced as `unknownItems`.
- One placeholder per underlying layer per scene; a shared layer is listed in every scene that reaches it.
- Structural exclusion by AE fact only (disabled layer, disabled precomp reference, shape/camera/light,
  uniform solid); genuine uncertainty goes to `unknownItems`, never hidden.
- Dispatch executes nested text/footage through the verified chain, fails closed for operations with no
  nested form (color/visibility/freeze/duration), refuses a foreign-composition placeholder with no chain
  (backstop for a stripped field), and refuses two mappings - in one scene or across included scenes - that
  write different content to the same layer.
- Plan edits refuse the unsupported operations at edit time (manifest now loaded in production for them).
- Scene-evidence dispatch no longer reads nested placeholders' indices inside the scene composition.

Three independent code-review rounds found 8 real defects in this change; all fixed before commit.

**Deploy order is a hard gate: API first, then worker.** An older API strips `nestedTarget` (the manifest
schema does not reject unknown keys) and its dispatch lacks the guards.

### Known limitation (deferred, found in review round 3)

Preview Timing Analysis (`apps/api/src/domain/preview-timing/derive-preview-timing-targets.ts`,
`apps/web/src/lib/preview-timing.ts`) still walks only a mapping's `humanNestedTarget`. Content filled
through a nested **manifest** placeholder contributes no timing evidence, so a *recommended* First Preview
timestamp can ignore it. This degrades a recommendation only - preview approval remains a human gate and the
timestamp can be chosen manually. Fix: pass the manifest and treat `placeholder.nestedTarget` like
`humanNestedTarget` in both mirrors.

### Live re-inspection evidence (2026-09-13)

- Deploy `c1245b4`: counts unchanged vs baseline, schema proven to preserve `nestedTarget`, no post-deploy errors.
- Worker build confirmed remotely: worker log `"commit":"c1245b48f76bf18b5618dca4b45ea00ca7adcea3"` (unredacted).
- Process tree (diagnostic `a3b39888`): exactly one PowerShell supervisor, one node supervisor, one worker, one AfterFX.
- MCP after install: `bridge-not-connected` -> recovered by bounded `ae_reconnect` attempt 1 (body:
  `"Bridge reconnected (one manual inject)", instances: 1`); bridge registered ~90s later; no attempt 2.
- Inspection job `7889a130-6a19-4e24-a097-ed4f5f577a4e`: SUCCEEDED in 78s, exact project opened.
- Validator (`validate-manifest.mjs`, checked against real AE `numLayers` and the composition graph): **ALL CHECKS PASS**.

| Proof point | Result |
|---|---|
| Worker/AE/MCP ONLINE during job | 5 worker-log heartbeats inside the job window, all green; 8 server-side distinct heartbeats green |
| Nested editable layers, correct `layerPath` | 21 nested placeholders; every chain ends at its own layer, verifies against the graph, matches `layerPath`, and every hop index exists in AE |
| CONTROLS not the only editable | 22 editable (was 1) |
| missingFootage / pluginReferences / unknownItems | 0 / 0 / 0 |
| Source SHA-256 | `4172ee082c1ce15f9e180d17e128434d4b54a40b3596402e1a30e496415deafd` (unchanged) |

### Not yet acceptance-ready - open semantic questions

The validator proves every surfaced placeholder is a real, correctly targeted layer. It cannot prove none were
missed or that each is the right KIND of slot:

- 10 of 21 nested placeholders are `Smartphone_0X_Beauty_Pass.mov` pre-rendered videos - genuine video layers,
  but likely phone-hardware render passes (CLAUDE.md protects phone hardware), not client media slots.
- `_Place Image Above_*` compositions surfaced only guide-style text ("PLACE YOUR IMAGE HERE", "APP SCREEN",
  "1", "2"); their other layers were excluded as structural, so the real screen image slot may be an excluded
  solid.
- `Smartphone_01` / `Smartphone_02` surfaced no "Text 1/Text 2", unlike 03-05.

Resolving these needs per-layer AE evidence for the excluded layers via INSPECT_SCENE_EVIDENCE, which requires a
real project for this template (none exists yet).

### Observed gaps

- `workers.current_job_id` stayed null throughout the job (the worker heartbeat always reports
  `currentJobId: null`), so the dashboard cannot show the worker's current job.
- Validation job `7889a130` was dispatched by direct DB insert (dashboard sessions are stored hashed and cannot
  be reused), so it has no `created_by_user_id` and cannot be opened from the dashboard; the operator's own
  wizard run is required to create the project.

## 2026-09-13 - New Project wizard locked by a cancelled inspection (fixed, `c0affa0`)

Symptom (operator): FAHADNAKASH selected, Inspect Template disabled since the previous day, no job created.

Root cause, reproduced from production data for the current account: the wizard restores its in-flight job from
localStorage on every mount and cleared that draft only after a successful Create Project. The account's last
wizard dispatch `df76c2be` was CANCELLED during QA triage, and re-inspecting was allowed only for no job or a
FAILED job - so the restored CANCELLED job disabled the button permanently, with no message and no way to clear it.

Fix: CANCELLED is retryable like FAILED ("Inspect again"), an explanation is shown (English/Hebrew), the stale draft
is cleared once CANCELLED is known, and a remembered job returning 404 is forgotten. Reproduction test fed the exact
production DTOs: 4/5 failing before, 6/6 passing after; existing wizard suite unchanged.

The reported blank status badges were NOT reproduced: the exact production `/api/workers` response (via the real
`toWorkerDto`, accepted by the deployed web schema) carries ONLINE for status/aeAvailability/mcpAvailability, and the
wizard renders all three as "Online" from it. Not claimed as fixed.

End-to-end proof after deploy:
- Operator job `bafdd078-754d-4129-ac4a-0a39d5fdf800` created by the account at 10:21:07Z (button enabled, dispatch worked).
- SUCCEEDED in 115s; validator ALL CHECKS PASS; 105/105 per-placeholder checks; 7 in-job heartbeats all green.
- Cross-run determinism vs `7889a130`: 22/22 identical placeholderIds, 0 differences in composition, index, name,
  type, layerPath or chain; source SHA-256 identical in both runs.


## 2026-09-14 - Approve Scenes approved the plan but no scene (Mixkit Smartphone Promo Final)

Observed on the real project after all six scene previews succeeded:

- **Root cause.** Simple-mode "Approve Scenes" called only plan approval. Plan revision 3 became APPROVED while its only included scene (`Main_Comp`) stayed `READY_FOR_APPROVAL`. The Preview tab and execute-frame dispatch both require scene `approvalState === "APPROVED"`, so Preview showed "No approved scene to execute" and Start execution stayed disabled.
- **UX defect 1 - no feedback.** The first click returned HTTP 200 but the page gave no visible confirmation and the button stayed enabled.
- **UX defect 2 - technical error on a duplicate click.** The second click, 3 s later, reached the API and was refused with HTTP 409 ("Plan is APPROVED, not DRAFT"), shown as a raw error.
- **UX defect 3 - premature advance.** The stepper marked scene mapping Complete and moved to First Preview on plan approval alone, with no executable scene.

Fix: "Approve Scenes" approves every included, ready scene through the normal `APPROVE_SCENE` plan edit, then approves the plan at that revision; duplicate calls while running are ignored; once approved the button is disabled with a "Scenes approved" hint. The stepper requires an executable scene (use, APPROVED, no unresolved reasons) before scene mapping counts as complete. The affected project was repaired through the same two use cases; its mappings are unchanged.

## 2026-09-14 - Start execution failed on a temporarily busy single-concurrency worker (Mixkit Smartphone Promo Final)

Observed on the first real "Start execution" click:

- **What happened.** The click created execution session `1257ac95` (status `PREPARING`, 0/1 scenes) and then dispatched its EXECUTE_FRAME job, which the API refused with HTTP 409 WORKER_BUSY - the worker's single slot was held by a scene-preview job (`fd473d94`) the page had auto-queued at 10:53:10. That preview job was claimed and reported RUNNING at 10:53:19, then its result was lost when dyo-api restarted for a deploy at 10:53:26; the worker went idle but the job stayed RUNNING, blocking the slot until it was reconciled.
- **UX defect 1 - partial start.** Start execution creates (advances) the session before the dispatch succeeds, so a refused dispatch leaves a session with no job and a "Continue execution" button.
- **UX defect 2 - internal detail exposed.** The page showed "Could not dispatch this job - Worker accd0a71-... is already at its concurrency limit", exposing the internal worker UUID and concurrency wording to the client.
- **UX defect 3 - manual retry.** A temporarily busy maxConcurrency=1 worker is expected (scene previews share the slot); Start execution should wait for the slot and retry safely instead of failing and requiring a manual click.
- **Related gap.** A job whose final report is lost while the worker keeps heartbeating stays RUNNING indefinitely: the API only clears such jobs on a stale heartbeat or when a freshly started worker reconciles them, and a busy worker also refuses remote diagnostics.

## 2026-09-14 - First Preview failed at operation 3: project-item index drift (Mixkit Smartphone Promo Final)

Session `1257ac95`, job `e0039632`: operations 0-2 ran (two SET_TEXT, then the shared-screen MAP_FOOTAGE), and operation 3 (SET_TEXT, nested) failed with "project item index 41 resolved to composition id 2144960108 (Smartphone_03), expected id 2144954673". The working copy was never saved (its sha256 still equals the source, `4172ee08...`), and the source was verified unchanged.

- **Root cause.** Composition ids did not change - the composition found at index 41 carried its own manifest id. The MAP_FOOTAGE import inserted a project item and shifted every later project-item index; nested targets located each composition by its stored index. The scene composition's index was also resolved only once per job.
- **Second hazard.** The failed run's edits stayed unsaved in the open project, and a retry reuses an already-open project, so it would have re-applied operations on top of them (the card fill had already re-ordered a layer).
- **Fix (worker).** Nested steps resolve each composition by durable CompItem.id across all project items (the stored index is only a hint), requiring exactly one match; the scene composition is re-resolved before every operation and before capture; a fresh run reopens the working copy from disk, discarding unsaved edits, while a genuine resume keeps the open project.
- **UX defect 1.** The Preview page said "Worker is offline" for an operation-level failure (an earlier job, `f098570d`, was failed for a 30 s heartbeat gap while the worker was busy in After Effects).
- **UX defect 2.** The heading said "Could not dispatch this job" although the job was dispatched and ran through operation 3.
- **UX defect 3.** Raw internal ids (composition ids, project item indices) were shown with no useful recovery instruction.
- **UX defect 4.** Continue execution became disabled without explaining the safe next action.

## 2026-09-14 - First Preview retries after the index-drift fix (session 1257ac95)

- **Job `e26e6ea3`.** Operations 0-1 completed on the existing session, then the run paused safely: its checkpoint POST after operation 1 was stored by the API (HTTP 200, twice, ~60 ms) but the worker never received the response ("Failed to reach ..."). Fix: checkpoint reports are retried on transport failures (1 s, 3 s, 6 s) - re-sending the same checkpoint is idempotent - before the executor's existing pause.
- **Job `e80c36c4`.** Operations 0-3 completed - including the MAP_FOOTAGE import (operation 2) and the nested SET_TEXT that previously failed on index drift (operation 3), proving the durable-id resolution in real After Effects. It then failed re-resolving the scene composition before operation 4: "could not connect to ae-mcp: AE_UNRESPONSIVE (BRIDGE_TIMEOUT)". AE was responsive again moments later (working-copy.aep open, 47 items). That per-operation re-resolution opens a new ae-mcp connection each time and is not needed for nested operations, which resolve their compositions by id inside AE. Fix: only operations that address the scene composition by index re-resolve it; capture still re-resolves once.
- **Open observation.** Between 11:10 and 11:56 UTC the session working copy on disk changed (sha256 `1eaf519e...`, previously equal to the source) without any recorded save by the worker. The immutable source was verified unchanged throughout. Subsequent runs reopen that on-disk copy and applied operations 0-3 to it successfully; the cause of the change is not established.
- **Duplicate click risk.** Job `e80c36c4` was created from the dashboard 45 s after `e26e6ea3` failed, on the same session (no second session).

## 2026-09-14 - Retry safety check before the next First Preview attempt (session 1257ac95)

- **Verified behaviour.** Dispatch sends every EXECUTE_FRAME job with an empty checkpoint (all four jobs on this session had `payload.checkpoint = null`), so a retry never resumes: it re-applies all 9 operations. The session records no working-copy sha256 yet (no scene has succeeded), so the worker used to reuse `working-copy.aep` as-is.
- **Risk found.** That file changed on disk between 11:09 (sha256 equal to the source) and 11:56 (`1eaf519e...`) with no recorded save. Re-applying every operation to an unconfirmed copy that may already contain some of them could double-apply a non-idempotent edit (the screen-card fill re-orders layers).
- **Fix (worker).** A fresh run of a session's first scene rebuilds the working copy from the verified source (source sha256 checked before and after the copy), then reopens it from disk. A genuine resume keeps its copy, and a later scene's hash-confirmed working copy is never rebuilt - a mismatch is still refused as WORKING_COPY_SHA_MISMATCH.
- **Source.** The immutable source's sha256 was verified by the worker at the start of every run (last at 11:58:10 UTC: `4172ee08...deafd`) and is re-verified before and after any rebuild.

## 2026-09-14 - First Preview reached operation 7: a template-locked layer (session 1257ac95)

- **Clean start proven.** Jobs `8873bf84` and `e655c6bd` both started from a working copy byte-identical to the source (sha256 `4172ee08...deafd`) - the fresh-run rebuild works - and the source was verified unchanged at each start.
- **Progress.** Both completed operations 0-6 on the same session: every nested SET_TEXT (including the Hebrew line and the edit that previously failed on index drift) and the shared-screen MAP_FOOTAGE import.
- **Failure.** Operation 7 (MAP_FOOTAGE, the App Screen 01 card) failed: "Can not call method moveToBeginning ... because the Layer is locked". The template ships that card layer locked.
- **Fix (worker).** SET_TEXT and MAP_FOOTAGE unlock the target layer only for the approved edit and lock it again afterwards, preserving the template's lock state; if the lock cannot be restored the operation is reported failed, never left silently unlocked.
- **UX observation.** `e655c6bd` was created from the dashboard 39 s after `8873bf84` failed, on the same session (a second Continue click or a page resubmission) - no second session was created.
- **UX defect - raw technical error.** The Preview page showed the After Effects scripting error verbatim: `Can not call method "moveToBeginning" on Layer "e911189-0e21-49d2-97d8-411fd5e0750b.png" because the Layer is locked.` - an internal asset id as a layer name, AE method names, and no recovery instruction for the client.
- **UX defect - misleading heading.** The same failure was shown under "Could not dispatch this job", although the job had been dispatched and completed operations 0-6.
- **Layer order check.** `moveToBeginning` is required for a screen-card fill (the fitted media must sit above the card's guide labels). The fill now verifies the media is the composition's top layer afterwards and fails the operation otherwise.

## 2026-09-14 - First Preview job a4a0ac5e: After Effects busy longer than the mutation timeout (session 1257ac95)

- **Run.** Build `98a3594`. Started from a source-identical working copy; operations 0-2 completed (two SET_TEXT, the shared-screen MAP_FOOTAGE fill). Operation 3 (SET_TEXT) failed ~26-30 s later: "TRANSPORT_ERROR: AE_UNRESPONSIVE (BRIDGE_TIMEOUT)". Nothing was saved; still one session.
- **Evidence.** Seconds later AE answered normally (CHECK_HEALTH: working-copy.aep open, 47 items, bridge live) - a busy period, not a hang or dialog. Job `e80c36c4` earlier hit the same timeout right after a MAP_FOOTAGE import.
- **Cause.** Every mutation connection and call was bounded by a flat 30 s; ae-mcp's `ae_run_jsx` has no per-call timeout of its own.
- **Fix (worker).** Mutation connect bound 60 s, call bound 120 s. A timed-out mutation is still never retried (outcome unknown); the job fails honestly and the next fresh run rebuilds the working copy from the source.
- **UX defect.** The failure text tells the client to "restart AE if it is genuinely hung" for what was a transient busy period.

## 2026-09-15 - MutationTimeouts worker update aborted at the dependency check (worker offline)

- **What happened.** `DYO-Worker-RemoteDiagnostics-Update` (build `b29653e`) verified the ZIP hash, stopped the worker, backed up and copied the new program files, then aborted with `node.exe : npm notice ... FullyQualifiedErrorId : NativeCommandError`. It never verified the install or restarted the worker; the worker went OFFLINE (last heartbeat 13:19:56 UTC) with no active job and session `1257ac95` untouched.
- **Cause.** The installer runs with `$ErrorActionPreference = "Stop"` and called `& npm install ... *>$null`. Windows PowerShell 5.1 turns a native program's stderr into error records even when redirected, so npm's informational "npm notice" became a terminating error. The abort also bypassed the installer's own rollback/restart path.
- **Fix (installer).** npm runs through `cmd.exe /d /c "... > log 2>&1"` with a local `Continue` preference, so PowerShell never sees a stderr stream and only npm's exit code decides. Older one-off `*-Update.ps1`, `DYO-Worker-Setup.ps1` and `DYO-Worker-Repair.ps1` still carry the old call and must not be reused without the same change.
- **Recovery.** `DYO-Worker-Complete-Pending-Update` copies nothing: it checks registration/.env/task exist without reading them, refuses if any DYO Worker process runs or the maintenance flag is set, proves 10 installed files match the release SHA-256 values and BUILD_INFO commit, runs npm safely, proves pino/zod/MCP SDK load, then starts the existing Scheduled Task and requires exactly one supervisor and one worker process, stable across checks.
- **UX defect.** A failed dependency *notice* left the client's worker stopped with a PowerShell stack trace and no instruction; an installer must either finish or restore and restart the previous worker.
- **Follow-up - false "already running" (2026-09-15 13:35 UTC).** The first recovery script refused because one supervisor and one worker process existed, but that worker had sent no request to the API since 13:19:56 UTC (every heartbeat/claim after that in the API log came from a different worker, `345ee0a4`). A running process is not a healthy worker. Fix: an existing tree now blocks recovery only if its own worker.log shows a "heartbeat succeeded" (server status ONLINE) written by that exact PID during a 60 s observation window. A stale tree is stopped only after checks: no claimed-but-unfinished job in its log, no After Effects/aerender inside it, logs saved as evidence, and a last-moment heartbeat re-check. Success now requires two fresh heartbeats from the new process reporting ONLINE / AE ONLINE / MCP ONLINE, and the build commit it reports.
- **UX defect.** Recovery trusted process existence over the dashboard's OFFLINE status, so the operator got a "correct refusal" for a dead worker.
- **Follow-up - recovery v2 crashed; the "running" processes never existed (2026-09-15).** v2 verified build `b29653e` and all 10 file hashes, then printed `Found PID  (parent ), started :` twice and threw `Cannot convert null to type "System.DateTimeOffset"`. Root cause, reproduced exactly in PowerShell 7.4.6 with mock processes (Windows PowerShell 5.1 was not available for testing): the process lookups end with `return ,$found`, and callers wrap them again in `@(...)`, which nests the result - `.Count` is always 1, even with ZERO matching processes, and an empty nested array yields blank properties. So v1's "supervisor: 1, worker: 1" was false and no DYO Worker process was running; the worker was simply stopped. The same pattern in `DYO-Worker-RemoteDiagnostics-Update.ps1` makes its "exactly one supervisor, at least one worker" start check pass without actually checking. Not yet fixed in the scripts; neither may be reused until it is.
- **UX defect.** A recovery tool reported "processes are already running" and "nothing was changed" while the worker was fully stopped - the operator was told the opposite of the truth.

## 2026-09-15 - First Preview job 60fcab36: all 9 operations saved, then the preview capture timed out (session 1257ac95)

- **Run.** Build `b29653e`, one clean worker tree (PID 30028). Started from a source-identical working copy; operations 0-8 all completed (checkpoint `[0..8]`), the working copy was saved and hashed (`f38d5b258fbc627dcfe9c09c3e7c7b39cd6155d719fc4331d66d91ce08fad3f6`, `C:\DYO-Agent\execution-sessions\1257ac95-...\working-copy.aep`), and the immutable source was re-hashed unchanged (`4172ee08...deafd`) before capture. Capture then failed: `ae_capture_frame failed: MCP error -32001: Request timed out`. No preview file was produced in the job's artifact directory. Session stayed PREPARING with no recorded working-copy hash.
- **Capture cause.** Preview capture used the MCP client's flat 15 s default. After Effects kept rendering the still: a CHECK_HEALTH right after showed the ae-mcp bridge with no live heartbeat (0 instances); ~3 minutes later it was live again with `working-copy.aep` open. Fix (worker): capture has its own bounds (connect 60 s, call 180 s) and is never retried automatically, so a second render is never queued behind the first.
- **Retry hazard found.** A plain Continue would NOT have resumed: every EXECUTE_FRAME retry on this session was dispatched with `checkpoint: null`. The resume check compared `JSON.stringify(operations)` of the stored payload with the freshly resolved one, but `jobs.payload` is jsonb, which re-orders object keys, so it never matched. The retry would have rebuilt the copy and re-applied all 9 edits.
- **Fix (API + worker).** Operations are compared key-order-independently. A checkpoint is resumed only when every operation completed AND the worker recorded `savedWorkingProjectSha256` (written right after the save is hashed and the source re-verified, before capture). Such a resume is capture-only: the working copy is pinned to that hash (missing or different is refused, never rebuilt), reopened from disk, no operation applied, no save, re-verified byte-identical, then captured and uploaded. Partial checkpoints still start fresh, because their edits may only have existed unsaved in After Effects.
- **Health reporting defect.** During the stuck capture the worker heartbeat kept reporting MCP ONLINE while CHECK_HEALTH showed the bridge down, and after the bridge recovered the heartbeat reported MCP OFFLINE while CHECK_HEALTH showed it live - the heartbeat's MCP probe lags the real bridge state in both directions.
- **UX defect.** The Preview page again showed the failure under "Could not dispatch this job", although the job was dispatched, applied and saved all 9 operations, and failed only at the final preview capture.
- **Follow-up - process-count bug fixed (2026-09-15).** `Get-DyoSupervisorProcesses`/`Get-DyoWorkerChildProcesses` in `DYO-Worker-RemoteDiagnostics-Update.ps1` and `DYO-Worker-Complete-Pending-Update.ps1` now return plain pipeline output, and the installer's start check requires exactly one supervisor and exactly one worker. Validated on PowerShell 7.4.6 against the real function text loaded from both files, with a mocked process list: counts correct for 0/0, 1/0, 1/1, 2/1, 1/2, and the healthy check passes only for 1/1. Not run on Windows PowerShell 5.1; installs are still confirmed remotely with GET_DYO_PROCESS_TREE.
- **Outcome - First Preview captured by a capture-only resume (2026-09-15 15:13 UTC).** API and worker at `05dc0e3`; job `60fcab36`'s checkpoint was repaired with its verified saved hash (evidence-guarded SQL, one row). A read-only dry run first confirmed the old `JSON.stringify` check was false and the key-order-independent check true for the real stored payload. One Continue click created exactly one job, `660a7690`, carrying checkpoint `[0..8]` + `savedWorkingProjectSha256 f38d5b25...`. It ran for ~9 s (RUNNING 15:13:32 -> SUCCEEDED 15:13:41): no rebuild, working copy still `f38d5b25...` (pinned, not re-saved), source `4172ee08...deafd` intact, preview captured at t=0 (`Main_Comp_...png`) and uploaded (sha256 `2f703615...`). Session `1257ac95` -> AWAITING_PREVIEW_APPROVAL, scene `a83f132f0b519cf3` completed; still the only session.
- **UX defect - "ready to render" before any real preview review (2026-09-15 15:13 UTC).** Right after job `660a7690`, the dashboard showed "1/1 scenes completed — ready to render" while the session was still AWAITING_PREVIEW_APPROVAL (`first_preview_approved = false`), with Approve/Reject preview buttons. The First Preview it asks the operator to approve was captured at the default t=0 and shows only a phone with a blank dark screen on a blue background - none of the approved screenshot, text or logo edits are visible (same class as the 2026-09-08/09 t=0 incident). The page invites approval of a frame that cannot demonstrate the edits, and the "ready to render" wording skips the approval gate it still requires.

## 2026-09-16 - First Preview shows plain dark cards: the template's Fill effect survived image replacement (session 1257ac95)

- **Symptom.** Regenerated First Preview frames (t=0 job `660a7690`, t=2 s job `c43e5bf2`) showed the phone screen and both App Screen cards as flat dark-grey rectangles - no screenshot (dark-navy "Vehicles" app UI with white text) and no logo (red SIM icon on light grey). The worker had reported every MAP_FOOTAGE operation successful.
- **Timing (read-only, source template, job `c94834a9`).** Main_Comp (21.44 s @ 25 fps) plays Smartphone_01 at 0.00-4.00 s, 02 at 4-6, 03 at 6-11.04, 04 at 11.04-16.04 and 05 at 16.04-21.44 s. The screenshot and logo slots live in Smartphone_01 and the Hebrew text in Smartphone_05, so no single frame can show all three.
- **Root cause (read-only working-copy inspection, 9 jobs pinned to `f38d5b25...`, nothing saved).** In `_Place Image Above_App Screen 01`, `_Place Image Above_App Screen 02` and `_Place_Image_Above_Mobile`, the replaced layer is top-most, enabled, 0-64 s, 100 % opacity, not 3D, not time-remapped, cover-scaled and centred - and carries an enabled `ADBE Fill` effect. MAP_FOOTAGE uses `replaceSource`, which keeps a layer's effects; the template card solids get their dark-grey colour from that Fill effect, which then paints every opaque pixel of the new media one colour. Not read: the Fill colour value and track-matte state (the inspection scripts do not report them).
- **Fix (worker).** For a solid screen-card replacement, every enabled `ADBE Fill` effect on the replaced layer is switched off (never deleted), then re-checked; one that stays on fails the operation with its name. Other effects and ordinary (non-solid) footage replacement are untouched.
- **Open risk - logo fit.** The card fill cover-scales and keeps the solid's relative anchor. A near-square 469x533 logo on a tall card is scaled ~500 % and cropped to part of the logo; a contain/centred fit for logo mappings has not been decided.
- **Recovery.** The saved working copy already contains the enabled Fill effects and no approved operation can correct it in place: install the fixed worker, reject the current First Preview (session FAILED by design), start a new execution session from the untouched source, then check frames at 2 s (phone 01) and 19 s (phone 05) before approval.
- **UX defect.** A MAP_FOOTAGE operation that produced an invisible replacement was reported as successful; nothing in the product verifies that replaced media is actually visible.
- **Follow-up - logo contain fit (2026-09-17, operator chose "fit inside the card, centred, fully visible, never cropped or stretched").** A mapping approved with `selectedAssetType: "logo"` now dispatches its MAP_FOOTAGE with `fit: "contain"`; every other asset omits `fit` and keeps the cover fit (plus the Fill switch-off). On a solid screen card, contain never swaps the solid's source: the solid stays as the card background with its own colour and is raised above the card's guide labels, and the logo is added as a new layer directly above it - anchor at the logo's centre, positioned at the card's centre computed through the card's own anchor, scale and rotation, uniform scale min(cardWidth/logoWidth, cardHeight/logoHeight), with the card's rotation, parent and timing. Animated card geometry, a zero/mirrored card scale, or media that does not land directly above the card fails the operation. A non-card target keeps the plain source swap.
- **Rollout order.** The worker's operation schema is strict, so the worker that understands `fit` must be installed before the API that sends it; that worker still runs jobs without `fit` from the current API.

## 2026-09-17 - Fresh execution session 069b5891 with the Fill-effect and logo-fit fixes

- **Setup.** Worker `b7b6189` installed (one process tree, 5-minute stable ONLINE/AE/MCP heartbeats, bridge live) and then API `b7b6189` deployed. A read-only dry run of a new session's first job showed 6 SET_TEXT + 3 MAP_FOOTAGE from plan revision 4 (all 9 mappings unchanged, Hebrew code points U+05DE U+05D1 U+05D9 U+05EA U+0020 D Y O U+0020 A p p), the logo (`3b1909c3f16528ca`) with `fit: contain` and both screenshot placements without `fit`. Source `4172ee08...deafd` re-verified by the worker before the rollout.
- **Reject.** The First Preview of session `1257ac95` was rejected (session FAILED). Because it still had a completed scene, a working-copy hash and a preview, the API kept returning it as "recoverable for preview regeneration" and the Preview tab offered only Regenerate First Preview. Its working copy was proven defective (Fill effects saved in, logo cropped), so `working_copy_trusted` was set to false with an evidence-guarded one-row update; the tab then offered Start execution.
- **Run.** One click created exactly one new session, `069b5891`, and one job, `ea1bf1e2`: operations 0-8 applied 14:52:39-14:53:06 UTC, saved working copy `c065ba334e83905b67bd74ecf719a9680aba6f25975518413e3c84ccb910c3e8` recorded before capture, source intact, SUCCEEDED 14:53:12 UTC with a t=0 preview (sha256 `ba3a72b9...`). Session AWAITING_PREVIEW_APPROVAL. Largest heartbeat gap 16 s.
- **Visual result.** The t=0 frame shows the replaced screenshot (the "Vehicles" app UI: location pin, "0 kph", "OFFLINE since > 2 days", excavator icon, "DL3SEP1916-nhtrax") filling phone 01's screen - the Fill-effect fix works in a real render. The logo card and the Hebrew text are not in this frame; they still need frames at 2 s (phone 01) and 19 s (phone 05).
- **UX defect.** After rejecting a First Preview whose edit was genuinely wrong, the dashboard offered no way to start a new session: Start execution is hidden whenever the latest FAILED session still qualifies for preview regeneration. Recovery needed a direct database change.
- **Frames and Hebrew read-back (session 069b5891, 2026-09-17).** Regenerations were preview-only, each exactly one job, working copy `c065ba33...` unchanged, source intact: 2 s (`2582cc78`), 19 s (`909ac41d`), 21 s (`4c752bc3`). At 2 s the replaced screenshot shows on the phone and the App Screen 01 card, and the logo shows whole, centred and unstretched on the App Screen 02 card with no guide labels. A read-only inspection of the working copy (`453aa8ae`, hash-pinned, nothing saved) read Smartphone_05 layer 2 "Text 1" as exactly `מבית DYO App` (code points U+05DE U+05D1 U+05D9 U+05EA U+0020 U+0044 U+0059 U+004F U+0020 U+0041 U+0070 U+0070; programmatic equality true).
- **Open defect - Hebrew line clipped.** At both 19 s and 21 s only " DYO App" and two Hebrew glyphs render; the area where the rest of the Hebrew word should be is empty background. It is not the phone (both text layers are above the phone precomp in Smartphone_05, and the gap is uncovered) and not animation timing (19 s and 21 s match). Likely, but not proven: the right-aligned replacement line is wider than the visible area the template gives that slot (a mask/matte or text-box limit used for the slide-out), so its left end is clipped. The current inspection scripts do not report masks, track mattes or text-box bounds. First Preview must not be approved while the required Hebrew brand text is not fully visible.
- **Follow-up - read-only text-clipping inspection (2026-09-17, operator chose "prove the cause first").** New INSPECT_SCENE_EVIDENCE mode `describeTextLayerClipping: { layerIndex, timeSeconds }` (buildInspectTextLayerClippingScript) describes ONE layer at ONE time: enabled/in/out/start, parent, track matte (isTrackMatte, hasTrackMatte, type, matte layer, falling back to the layer above when trackMatteLayer is unsupported), every mask (mode, inverted, shape bounds, feather, opacity, expansion at that time), rendered rect (sourceRectAtTime), transform at that time, text document (length, font, size, justification, box text size/position), text animators with range-selector start/end/offset and animated properties, and effects. Read-only by construction: only value/valueAtTime/sourceRectAtTime reads, each individually guarded; no setValue, no save. The response keys `textLayerClippingFacts`/`textLayerClippingFactsFailureReason` appear ONLY when the mode is requested, so every other evidence response keeps its exact shape and the deployed API needs no change; job results are stored without schema validation and project-less jobs are never recorded as evidence.
- **Follow-up - mode renamed and extended for the screenshot (2026-09-17, before any install).** The operator also reported the replaced screenshot looking horizontally compressed with too much empty space below. The same read-only mode now serves any layer and is named `describeLayerAtTime` (response keys `layerAtTimeFacts`/`layerAtTimeFactsFailureReason`, builder `buildDescribeLayerAtTimeScript`). It additionally reports the layer's source (kind composition/solid/footage, width, height, pixel aspect, duration), the composition's pixel aspect, and each effect's plain settings at that time (e.g. a Corner Pin's corners), capped at 24 per effect. After Effects stores no "fit method"; it is derived from source size, card size and scale. The replaced card's original solid size is only available from the untouched source template's own placeholder layer. Known before inspection: App Screen 01's replaced layer carries an uneven scale (150.25 % x 148.02 %) inherited from the template solid, and the screenshot file itself (879x1789) has a large empty navy area below its content.
- **Inspection results (worker `fdf84b9`, session 069b5891, working copy `c065ba33...` hash-verified on all 10 read-only jobs, nothing saved, 2026-09-17).**
  - **Hebrew "clipping" is proven to be colour, not clipping.** Smartphone_05 "Text 1": no masks, no track matte, point text (no box), HelveticaNeue-Bold 182 pt, RIGHT_JUSTIFY, scale 80 %, coloured by an enabled Fill effect `[1, 0.66139823198318, 0.26009500026703]`. Layer 5 "BG Color 2" (the orange circle) carries a Fill with exactly the same colour; layer 6 "BG Color 1" is the navy background `[0.2196, 0.2314, 0.4627]`. From rects/masks and transforms: circle ~x 102-827, y 155-880; text ~x 707-1540, y 420-550 in the 1920x1080 composition. The right-aligned, longer Hebrew line extends left over the circle, so ~120 px of orange glyphs sit on the orange circle and are invisible. The template's shorter original text stayed over navy. Brand note: this line is DYO branding, which the permanent brand rules require in the official DYO blue - it kept the template's orange.
  - **Screenshot, card level.** Source 879x1789, pixel aspect 1; every composition pixel aspect 1; image Fill effects are off; no masks or distorting effects on the image layers. Phone-screen card (`_Place_Image_Above_Mobile`, 1242x2688): uniform scale 150.25 %, no distortion. App Screen 01 card: scale 150.25 % x 148.02 % - the cover fit multiplied the template solid's uneven scale, so the image is 1.5 % wider than its aspect (not narrower). The fit keeps the template solid's off-centre relative anchor, so on the phone-screen card the image spans x 154-1474 of 1242 (about 193 px right of centre). Host layers: Placeholder_01-1 / Placeholder_05 at 100 %; Smartphone_01_PreComp L7 (12 %) and Smartphone_05_PreComp L6 (14.5 %) are uniformly scaled 3D layers parented to device-animation helpers and shown through LUMA track mattes from `Smartphone_0x_Placeholder_Mask*.mov`.
  - **Empty navy space is in the image.** Pixel scan of 11222.png: last content card ends at row 964 (54 %), the bottom tab bar starts at row 1686 (94 %) - a 722 px band (40 % of the height) with no content.
  - **Not proven: the horizontal compression.** Nothing at card level narrows the image. Remaining candidates are the device helpers' 3D rotation/perspective and the luma matte cropping the sides; the inspection does not yet read 3D X/Y rotation/orientation (rotation reads came back null on the 3D host layers) and cannot see inside the matte footage.
- **Source comparison and the proven screenshot offset (2026-09-17, read-only on the untouched template, hash `4172ee08...deafd` verified on every job).** Main_Comp captured from the source at 2 s, 19 s and 21 s shows the same layout as the working copy; at 19 s/21 s the template's own "PLACE YOUR IMAGE HERE" keeps roughly its 2 s proportions, so the device's 3D turn does not visibly squash content at those moments (visual estimate from 640 px frames). The template's placeholder solids are ordinary: phone screen 1242x2688 at 100 %, anchor/position (621,1344), exactly covering its card; App Screen 01 1242x2688 at 100 % x 98.51 %, anchor (621,1344), position (621,1324), exactly covering its 1242x2648 card. The working copy's screenshot anchor (311.05, 595.34) equals the solid centre scaled twice by media/solid size (621 x (879/1242)^2, 1344 x (1789/2688)^2): replaceSource already rescales the anchor and the fit rescaled it again, so the screenshot sits 193 px right and ~450 px down on both cards (uncovered top/left, ~450 px of image hanging below the card), and App Screen 01 is stretched 1.5 % by multiplying the template's uneven scale.
- **Screenshot fix (worker, not yet packaged).** Cover reads the card's anchor/scale/position/rotation BEFORE replaceSource, sets the anchor to the media's own centre, applies ONE uniform scale covering the card's rendered size, and centres the media on the card through the card's own anchor, scale and rotation; animated or mirrored card geometry is refused. Resulting geometry: phone screen 150.25 % centred at (621,1344), 39 px overhang per side; App Screen 01 148.02 % centred at (621,1324), no distortion. A regression test whose fake replaceSource rescales the anchor like After Effects caught the first draft reading geometry after the swap. The screenshot asset is unchanged; its built-in 40 % empty band is a separate decision.
- **Hebrew proposal (not implemented).** Original "Text 1" (6 characters, same font/size/scale/colour, right-aligned) rendered ~x 1155-1545 over navy; the Hebrew line renders ~x 707-1540; the same-orange circle's right edge is ~x 827. Proposed generic auto-fit: keep right alignment and uniformly shrink the replaced line just enough that its rendered bounds clear lower layers filled with the text's own colour (plus a margin), refusing below 60 % of the template scale. Here: ~851-1540 available -> 80 % -> ~66 % scale (~83 % of the template text size). Rejected: fitting to the original text width (37.5 %, too small) and shifting right (breaks alignment with the paragraph below).
- **Hebrew auto-fit built (worker, operator-approved proposal, 2026-09-17).** After SET_TEXT sets the text, a plain unparented 2D text layer with static, unrotated transform is checked against every enabled unparented unrotated 2D layer BELOW it whose fill colour (enabled Fill effect, else solid colour) matches the text's colour (enabled Fill effect, else text fill) within 0.02 per channel, bounded by its ADD masks (else its rendered rect), measured midway through the text's visible time. If they overlap within a margin (1.25 % of composition width, >= 8 px), the text is shrunk uniformly about its own anchor by the largest factor that clears every such shape - never enlarged, never moved; below 60 % of the template scale the operation fails instead. Unmeasurable cases skip the fit. For session 069b5891's geometry this gives 80 % x ~0.827 = ~66 %, the line's left edge one margin right of the circle. Helpers are ES3 function expressions (no block-level function declarations inside ExtendScript try blocks). No API change.
- **Worker `81c3df3` install - automatic bridge recovery started a second After Effects (2026-09-17 16:00-16:04 UTC).** The new worker (PID 4020) launched After Effects itself at 16:00:20 ("After Effects was not running - started it automatically", PID 2136). The bridge probe stayed pending to its 45 s deadline; at 16:01:08.0 the worker ran `ae_reconnect` ("reported success"), and at 16:01:08.9 a second AfterFX.exe (PID 9572) started from a short-lived parent. Every probe after that reported "bridge-not-connected" and CHECK_HEALTH showed 0 live instances. Both processes had exited by 16:03 and a single After Effects (PID 18176, started 16:01:58 from the desktop session, no longer a child of the worker) came up; at 16:04:07 the bridge was live with 1 instance and heartbeats ONLINE/AE/MCP. Defect: the automatic reconnect can launch an additional After Effects process instead of reconnecting the running one, leaving no bridge; the heartbeat meanwhile reported MCP OFFLINE correctly but AE ONLINE throughout.
- **Fresh session e0483ad6 with worker `81c3df3` (2026-09-17).** After 5-minute stable heartbeats (21 beats, worst gap 16 s), a live bridge, source hash `4172ee08...deafd` confirmed and plan revision 4 with all 9 mappings unchanged, session 069b5891 was rejected and its working copy marked untrusted (evidence-guarded one-row update). One Start execution click created exactly one session, `e0483ad6`, and one job, `5ebbf6f2`: operations 0-8 applied 16:13:34-16:13:55 UTC, saved working copy `27a4810b16d2e35b596cba4a3103ef36b8edc268dc1e2af8e02f2baa833311c9`, source intact, SUCCEEDED 16:14:01 with a t=0 preview (`bb238d61...`). Read-only inspection of the new working copy (hash-verified, nothing saved): Smartphone_05 "Text 1" scale 66.22 % (was 80 %), anchor/position unchanged, rendered x 850.8-1540.5 - exactly one 24 px margin right of the orange circle (826.8); phone-screen image anchor (439.5, 894.5) = media centre, position (621,1344), uniform 150.25 %, covering x -39.4-1281.4, y 0-2688; App Screen 01 image anchor (439.5, 894.5), position (621,1324), uniform 148.02 %, covering x -29.5-1271.5, y 0-2648; both Fill effects off.
- **Frames for session e0483ad6 (2026-09-17, each a single preview-only job, working copy `27a4810b...` unchanged, source intact, stored files match their hashes).** t=0 (`5ebbf6f2`): phone 01 close-up of the screenshot with no dark gaps. 2 s (`73231882`): screenshot whole and centred on the phone (top header to bottom tab bar) and on the App Screen 01 card; the SIM logo whole and centred on the App Screen 02 card, no guide labels; the cover fit trims ~3 % per side of the screenshot on the phone screen (39 of 1242 px). 19 s (`fc580ee2`) and 21 s (`c721e4ae`): the Hebrew line is fully visible in orange over navy, just right of the orange circle, right-aligned with the unchanged paragraph; phone 05's screenshot centred with its tab bar visible. Glyph order was not judged visually; the stored text was read back by code point. Still open, by operator decision: the Hebrew line keeps the template's orange (not DYO blue), and the screenshot asset keeps its built-in 40 % empty navy band.
- **First Preview approved (session e0483ad6, 2026-09-17 16:22:33 UTC).** One Approve click: `first_preview_approved = true`, session READY_TO_RENDER (its one required scene, `a83f132f0b519cf3`, complete), working copy `27a4810b...` trusted and unchanged, plan revision 4 APPROVED, no job created by the approval, worker ONLINE/AE/MCP. Sessions 1257ac95 and 069b5891 remain FAILED and untrusted. Next workflow gates (not started): brand/typography approval, complete preview, landscape and native 1080x1920 Reels outputs, final approval, render.

## 2026-09-17 - Brand and typography approval gate for session e0483ad6: not passable yet

- **Gate does not exist in the product.** `ApprovalsPage.tsx` renders the "Branding, type & colors" card as structure only ("No approval-gate API exists yet - ... nothing server-side tracks their state today"). There is no API route, session/plan field or dashboard control that records brand/typography approval.
- **Passed (against `dyo-brand-rules.yaml` and the rendered frames).** Logo presence: the active Main_Comp scene maps asset `1db2ea1f...` as a logo, and it renders whole and centred at 2 s. Required Hebrew text: the active mapping holds exactly `מבית DYO App`, read back from the working copy by code point, and the whole line is visible at 19 s and 21 s. Contrast: orange text `#FFA942` on the navy background `#383B76` measures 5.34:1 (WCAG AA for normal and large text; not AAA 7:1). RTL: the text operation clones the template TextDocument and changes only `.text` (glyph order not judged visually).
- **Blocker - DYO blue not configured.** `dyoBlueHex` is null, so the "DYO App branding must use the official DYO blue" rule is not enforced (validator warning only); the Hebrew DYO line keeps the template's orange by operator decision. The rule cannot be satisfied or checked until the client supplies the hex value.
- **Blocker - no typography requirements are defined.** No approved fonts, sizes, weights or colour rules exist in configuration or code; only the template's referenced fonts are recorded (`Arial-BoldMT`, `HelveticaNeue`, `HelveticaNeue-Bold`).
- **Blocker - font availability unverified, substitution likely.** Nothing checks whether those fonts are installed on the worker. The Hebrew layer's font is reported as HelveticaNeue-Bold, yet every frame - including the untouched template's own "Mixkit" line - renders that text in a serif face, consistent with After Effects substituting a missing font. Not proven: the inspection does not read font-substitution state.
- **Read-only font check built (worker, 2026-09-17; operator: keep the orange Hebrew line and treat the template typography as the temporary standard for this QA run; no DYO blue invented, no approval record created).** INSPECT_SCENE_EVIDENCE gains `describeFonts: true` (buildDescribeProjectFontsScript): for every text layer of every composition it reads the TextDocument font and fontObject; for each distinct PostScript name it reports usages (composition, layer, keyframed text, font actually rendered and whether it is a substitute), the fonts After Effects finds installed (`app.fonts.getFontsByPostScriptName`) and whether it appears in `app.fonts.missingOrSubstitutedFonts`, with status installed / substituted / missing (unknown without the app.fonts API). Reads only; no setValue, no save; response keys `fontFacts`/`fontFactsFailureReason` only when requested, so no API change.
- **Font check on session e0483ad6's working copy (worker `375935c`, job `2ee2114f`, hash `27a4810b...` verified, nothing saved, 2026-09-17 16:38 UTC).** After Effects' app.fonts API was available; 11 text layers. Arial-BoldMT (5 guide-label layers, now covered) renders in real Arial Bold (`C:\Windows\Fonts\arialbd.ttf`). **HelveticaNeue** (Text 2 in Smartphone_03/04/05 - the kept paragraphs) and **HelveticaNeue-Bold** (Text 1 in Smartphone_03/04/05 - including the approved Hebrew line) are NOT installed: After Effects renders both through **Times New Roman** (`C:\Windows\Fonts\times.ttf`, `isSubstitute: true`) and lists both in `missingOrSubstitutedFonts`. So the template's typography is not what renders on this worker: all six visible headline/body texts are Times New Roman. The Hebrew auto-fit (66.22 %) was measured with Times New Roman metrics.
- **Defect found and fixed in the font check.** That job labelled both Helvetica fonts `status: installed` although its own raw facts showed `isSubstitute: true` and the missing/substituted listing: After Effects delivered the values as wrapper objects, so strict `===` comparisons failed. Values are now normalised to primitives before comparison (`String(v) === "true"`, `String(name)`), with a regression test reproducing the wrapper objects. The raw facts of job `2ee2114f` were unaffected.
- **Complete Preview for e0483ad6: not ready.** The job itself only renders the hash-verified working copy through aerender (never the source, no save), and the session meets its session preconditions, but plan revision 4 has `renderOutputs = {"LANDSCAPE": null, "REELS": null}`, so dispatch is refused ("Landscape output is not configured ... configure it in Render Settings"). Also open: the rendered typography is a Times New Roman substitution, not the template's Helvetica Neue.

## 2026-09-17 - Complete Preview readiness for session e0483ad6 (read-only)

- **Operator decision - Option A, this QA run only.** The current Times New Roman substitution is accepted so the end-to-end workflow can be completed. **Production blocker (unchanged):** HelveticaNeue and HelveticaNeue-Bold are not installed on worker FAHADNAKASH; six visible headline/body layers, including the Hebrew brand line, render in Times New Roman. No production output may be accepted until the fonts are installed (or an approved replacement is defined) and the Hebrew auto-fit is re-measured with the real metrics.
- **Render templates After Effects offers (job `ef3bf79f`, INSPECT_RENDER_CAPABILITIES, 16:45 UTC).** Render settings: `Best Settings`, `Current Settings`, `DV Settings`, `Draft Settings`, `Multi-Machine Settings`, `_HIDDEN X-Factor`. Output modules: `AIFF 48kHz`, `Alpha Only`, `H.264 - Match Render Settings -  5 Mbps` (two spaces before 5), `H.264 - Match Render Settings - 15 Mbps`, `H.264 - Match Render Settings - 40 Mbps`, `High Quality`, `High Quality with Alpha`, `Lossless`, `Lossless with Alpha`, `Multi-Machine Sequence`, `Photoshop`, `TIFF Sequence with Alpha`, and six `_HIDDEN X-Factor ...` modules. The check adds and removes a temporary render queue item in memory and never saves; the next project open suppresses dialogs and discards unsaved changes.
- **Main_Comp is the landscape master.** Manifest `comp-2144961805`, project item 1, 1920x1080, 25 fps, 21.44 s, not nested-only, and the only one of 21 compositions with that name (aerender selects `-comp` by name).
- **Recommended LANDSCAPE configuration (not applied).** `Main_Comp` + `Best Settings` + `H.264 - Match Render Settings - 15 Mbps`. Reasons: the Complete Preview output path is fixed as `.mp4` and uploaded as `video/mp4`, so only the H.264 modules match (High Quality/Lossless write QuickTime/AVI); this exact pair succeeded twice on this worker (2026-09-10 14:49, 2026-09-11 10:39); Best Settings gives full resolution and quality, and the executor passes the composition's full frame range with -s/-e, so the template's Work Area default cannot shorten it. Configuring a render output updates `render_outputs` on the current plan row only (no new revision), so session e0483ad6 stays bound to revision 4.
- **UX defect.** The Render Settings tab takes template names as free text even though a capability check can list them; a mistyped name (e.g. the earlier "best setting") passes the dashboard and fails only after aerender runs.

## 2026-09-18 - Complete Preview rejected: leftover template copy, and the working copy changed on disk

- **Complete Preview rendered and is genuine.** Job `a68b3876` (2026-09-17 16:53:38-16:54:58 UTC) rendered Main_Comp from working copy `27a4810b...` (hash verified before and after, source `4172ee08...deafd` intact), Best Settings + `H.264 - Match Render Settings - 15 Mbps`, 39,624,402 bytes of MP4.
- **Blocker - five of the six visible text layers still carry the template's own words.** Read-only audit of the whole project (jobs `66a970d2`, `a83494f7`, `3624201d`, `573d3626` on the working copy; `be76bb5c`, `a9d9382f`, `bb8a0305` on the untouched source, every one hash-verified, nothing saved). Main_Comp holds six top-level layers: CONTROLS (disabled guide), Smartphone_01 0-4 s, Smartphone_02 4-6 s, Smartphone_03 6-11.04 s, Smartphone_04 11.04-16.04 s, Smartphone_05 16.04-21.44 s; work area = full 21.44 s. Smartphone_01/02 contain no text. The project's 11 text layers are: 5 guide labels inside the placeholder compositions (`APP SCREEN 1/2`, `PLACE YOUR IMAGE HERE`, Arial-BoldMT), now covered by the replaced images, and 6 headline/body layers, all three pairs byte-compared against the source:
  - Smartphone_03 (6-11.04 s): `Assets` and `From some of the \rworld's most talented \rcreators ` - both identical to the source, unchanged.
  - Smartphone_04 (11.04-16.04 s): `Free!` and `You'll always find \rthe perfect high-quality \ritem to download ` - both identical to the source, unchanged.
  - Smartphone_05 (16.04-21.44 s): Text 1 changed from the template's `Mixkit` to the approved `מבית DYO App`; Text 2 `Perfect high-quality\ritems for your next\rvideo project.` is identical to the source, unchanged. **This third piece of leftover copy was not reported by the operator and is on screen for the final 5.4 s.**
- **Root cause is the plan, not the execution.** Nothing is unmapped: plan revision 4 carries all 9 mappings, and all six text placeholders have a mapping. Five of those mappings were prefilled from the manifest (`mappingSource: MANIFEST`) with the template's own text and approved unchanged, so SET_TEXT rewrote each layer with the words it already had. Only the Hebrew mapping was edited by a human. **Product defect:** neither the mapping-review table nor plan approval flags a text mapping whose value still equals the template's original text, so an approved plan can silently ship template copy.
- **Blocker - session e0483ad6's working copy changed on disk after the preview.** `C:\DYO-Agent\execution-sessions\e0483ad6-.../working-copy.aep` now hashes `0b1589edcfd4060c90c5544221d2b19de013b195ffb741f649815ecb7eb2977f`, not the recorded `27a4810b...`, so every hash-pinned operation against it fails closed (first seen 2026-09-18 09:39 UTC). The worker log covering 16:33 UTC onward records no save and no job between the preview (16:54) and the change; the worker never saves during CREATE_PREVIEW or any inspection. The probable cause is After Effects' own in-memory copy being saved over the file: INSPECT_RENDER_CAPABILITIES (job `ef3bf79f`, 16:44) adds and removes a temporary render-queue item, which marks the open project modified, and After Effects was left open with that project overnight; a manual save or a "save changes?" prompt on close would write exactly this. **Generic lesson: a read-only capability check must not leave the session's working copy open and dirty in After Effects.** Content-wise the changed file still holds the same nine edits (all six texts and the three replaced images read back identically), but it can no longer be trusted as the approved artifact.
- **Original template unchanged** throughout: `4172ee08...deafd` re-verified on jobs `ba38cbe4`, `be76bb5c`, `a9d9382f`, `bb8a0305` (2026-09-18).
- **Removal mechanism that already exists.** A per-mapping `layerVisible: false` resolves to a real SET_LAYER_VISIBILITY operation, so a text layer can be hidden generically without a template-specific special case; editing mapping text goes through `updateExecutionPlan`, which always creates a NEW revision (`current.revision + 1`) and requires the plan to be approved again.

## 2026-09-18 - Stage 1 of the global implementation plan: bidirectional (RTL) text

Operator mandate: no template-specific logic; the Mixkit project is a regression fixture only. Nothing was executed against the current project, session or working copy during this stage, and no plan revision was created.

- **Direction is derived from Unicode, never from names.** New pure module `packages/schemas/src/text-direction.ts`: `analyseTextDirection` classifies text as RTL / LTR / NEUTRAL by matching `Script_Extensions` for the right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, N'Ko, Adlam, Samaritan, Mandaic, Kharoshthi, Mende Kikakui, Old Hungarian, Hanifi Rohingya, Yezidi), counting any other letter as strongly left-to-right. One RTL character makes the paragraph RTL, so mixed lines are handled as RTL paragraphs containing a Latin run. Script names the running engine does not recognise are skipped rather than throwing, so an older ICU build still works.
- **SET_TEXT applies direction and composer before the auto-fit.** For RTL text only, the mutation sets the paragraph direction to right-to-left and the composer engine to the Middle-Eastern-capable (universal) engine on the same TextDocument, then fits. LTR/NEUTRAL text leaves the template's own typography untouched (recorded as a note in the evidence).
- **Characters are never reversed.** The requested string is written as-is and read back; the stored text is compared with the requested UTF-16 code units position by position. A test asserts the generated script contains no reversal at all, and another proves a reversed string never verifies as equal.
- **Fails closed, never "warns and succeeds".** Missing `ParagraphDirection` API, missing Middle-Eastern-capable `ComposerEngine`, a throwing assignment, a direction/composer that does not read back, or stored text that differs from the requested code units each fail the operation with a typed reason (naming the first differing code unit where applicable). See `docs/ARCHITECTURE.md` for the full failure table.
- **Evidence is explicit.** `sceneEditResultSchema.textDirectionEvidence` carries one record per SET_TEXT operation (required direction, RTL scripts, mixed flag, previous and applied direction/composer, the three verification outcomes, code-unit count, note), tagged with its operation index. It defaults to `[]`, so previously stored results and older workers' results stay readable with no migration and no API/database change.
- **Tests: multiple synthetic templates, not just this one.** 16 Unicode cases (Hebrew, Arabic, mixed, Cyrillic, Japanese, digits/punctuation/whitespace/symbols, RTL with digits, multiline box text, astral characters, immutability); 13 behavioural cases running the real generated script in a V8 realm against synthetic fake After Effects builds that differ in layer/composition names, initial direction, API availability, assignment behaviour and storage fidelity; 2 executor cases for evidence plumbing; 2 schema cases for backward-readable parsing. Pre-existing SET_TEXT fixtures were updated to model a real AE 2026 build (both text-engine globals present) because Hebrew text now legitimately fails closed without them.
- **Results.** Focused: 16 + 13 + 2 + 2 new tests pass. Full suite: 3704 tests, 3703 passed, 1 unrelated web-component failure (`ProjectAssetsTab`) that passes on its own - a load-related timeout under the full run, not a regression. `npm run typecheck` clean.
- **Deployment order (when this ships):** schemas, then API, then a packaged worker install. Backward-readable in both directions: an older worker's result still parses, and a newer worker's result adds only a defaulted field.

### Stage 1 corrections (2026-09-18, operator-mandated)

- **Base direction is now first-strong (UAX #9 P2/P3), not "any RTL character wins".** Hebrew-first mixed text reads right-to-left, English-first mixed text reads left-to-right, and leading neutrals (digits, punctuation, quotes, whitespace) never decide it. Neutral-only text preserves the template's own settings. A separate `requiresBidiHandling` flag (any right-to-left character present) is what now triggers applying and verifying direction plus the Middle-Eastern-capable composer, because a Latin composer cannot shape a Hebrew or Arabic run whichever way the paragraph reads. An English-first mixed line therefore gets an explicitly left-to-right base direction AND the universal composer.
- **Mixed-direction regression tests added:** Hebrew-first, English-first, Arabic-first, leading quotes/digits/em-dash on either side, first-strong across multiline blocks, RTL line ending in Latin, Latin line ending in Hebrew - at analysis level, plus script-level cases proving an English-first line is written left-to-right with the universal composer and fails closed when that base direction cannot be applied.
- **`resultingValue` compatibility resolved by preserving the original shape.** Audit of every consumer (worker executor branches, `ae-edit-bridge`, the Element3D diagnostic CLI, template inspector, render-composition verifier, API, web) found none that would break, and nothing persists or renders a SET_TEXT `resultingValue`. Even so the original contract is now preserved exactly: SET_TEXT's `resultingValue` is again the stored text string, and the direction evidence travels as a separate optional `textDirection` key on the script result, passed through `ae-edit-bridge` and validated where it is consumed. Compatibility is therefore guaranteed by construction rather than by audit.
- **Full-suite flake fixed at its cause.** `@testing-library`'s 1 s async ceiling was too tight under parallel full-suite load (`ProjectAssetsTab`). The setup file now raises it to 5 s and the per-test timeout to 20 s **for DOM tests only** (`vi.setConfig` applies per file). A first attempt raised the timeout globally, which measurably disturbed the template-inspector hang/polling tests that exercise real bounded time budgets - node suites therefore keep Vitest's own defaults unchanged.
- **Results: 304 test files, 3715 tests, 0 failures. `npm run typecheck` clean.**

## 2026-09-18 - Stage 2 of the global implementation plan: the leftover-template-copy gate

Generic by construction: no template, composition, layer name, index, dimension or wording appears anywhere in the implementation. Nothing was executed against the current project, session or working copy, and no plan revision was created.

- **The template's own text is now captured.** The project-wide preflight scan reads each text layer's full text (bounded at 10,000 characters, with a truncation marker) alongside the existing 120-character preview, and template inspection carries it onto the manifest placeholder as `originalText`. Three states stay distinct and are never collapsed: a string (captured), `null` (captured, not a text layer), and an absent key (never captured - an older inspection or a truncated read).
- **Exact matches block plan approval.** `assessTemplateCopy` compares code point for code point; case folding and whitespace stripping are only ever used to recognise a near-miss, never to declare equality. Identical text blocks until an explicit decision.
- **Case-only and whitespace-only variants stay unresolved** until acknowledged, including line-break-only differences and combined case+whitespace ones.
- **Silence is never approval.** Clearing the gate takes an explicit `SET_TEMPLATE_TEXT_DECISION` (Replace or Keep Template Text). The stored record carries the decision, the deciding user, the time and `textAtDecision` - the exact text decided about - so a later text edit makes the decision stale rather than silently inheriting it. A `REPLACE` decision never unblocks text that is still identical. `updateExecutionPlan` refuses to record a decision with no known user rather than write an unattributable one.
- **Missing `originalText` requires re-inspection.** A legacy manifest blocks approval AND execution with "re-run template inspection", and no reviewer decision can override it - deliberately not a warning, because an unverifiable text is exactly what the incident shipped.
- **Duplicates across scenes are independent.** Each mapping is judged on its own text, placeholder and decision, so a template that repeats wording needs a decision per occurrence; scenes not marked for use are not judged at all.
- **Three enforcement points:** plan approval (`approveExecutionPlan`), execution dispatch (`resolveExecuteFrameDispatch` - a plan approved before this gate existed still cannot execute template wording), and a second, independent gate immediately before Complete Preview (`resolveCreateFullPreviewDispatch`), re-checked against the current manifest.
- **Dashboard.** The scene editor shows the warning, the template's own text, and the two explicit choices, computed with the same pure function the backend uses, so the UI can never claim a plan is ready when the backend would refuse it. English and Hebrew strings added.
- **Backward-readable, no migration.** Every new field is optional: `originalText`/`originalTextTruncated` on the manifest and `keepTemplateText` on a mapping. Absent and null mean "no decision"; there is deliberately no default. Existing stored plans, manifests and completed job records parse and read unchanged.
- **Tests (new): 19 schema cases** (Unicode incl. Hebrew/Arabic/Japanese, composed vs decomposed accents, multiline with carriage returns, case/whitespace/both, unknown and truncated capture, stale and explicit decisions, empty text), **10 gate cases** (duplicates across scenes, excluded scenes, legacy manifest, truncated capture, missing placeholder, human-added mapping, ordering), **9 approval cases** end-to-end, **4 execute-frame and 4 complete-preview dispatch cases**, **4 edit-operation schema cases**, **3 manifest capture cases**, **4 worker capture cases**, and **5 dashboard cases**. Several pre-existing fixtures gained `originalText` because, without it, they now correctly represent a legacy manifest that the gate blocks.
- **Results: 307 test files, 3778 tests, 0 failures. `npm run typecheck` clean.**
- **Deployment order:** schemas, then API, then a packaged worker install (the worker only adds capture; the gate itself is API-side). A worker that has not been updated simply reports no template text, which the gate treats as "re-inspect" rather than passing silently.

### Stage 2 follow-up (2026-09-19): long template text stays verifiable

**The bug this fixes.** Stage 2 marked any template text longer than the 10,000-code-unit bound as truncated and blocked approval with "re-run template inspection" - advice that could never work, because re-inspecting truncates the same layer again. A long template text was a permanent, unresolvable blocker.

- **One canonical algorithm, shared by every boundary.** New `packages/schemas/src/text-digest.ts`: pure TypeScript SHA-256 over explicitly-encoded UTF-8, with no platform API, so the worker (Node), the API (Node) and the dashboard (browser) compute byte-identical results. Pinned in tests against `node:crypto` and `TextEncoder` across empty, ASCII, Hebrew, Arabic, astral, lone-surrogate, Unicode-whitespace and multi-megabyte inputs. Whitespace is an explicit code-point set rather than a `\s` regex, and case folding is locale-independent; `assessTemplateCopy` now imports those same two functions, so the digest path and the full-text path cannot reach different verdicts. The algorithm name (`sha256-utf8-v1`) is stored with every record.
- **Verification metadata from the COMPLETE text.** For a text past the bound, the worker reads that one layer's text back in bounded slices (`buildReadLayerTextSliceScript`, read-only), reassembles it in order, verifies the reassembled length against what After Effects reports AND against what the scan saw, and computes the exact code-unit length plus four digests (exact, case-folded, whitespace-stripped, both). Slice reads fail closed - a failed or inconsistent read produces no digests rather than a digest of a partial string. Assembly is bounded at 2,000,000 code units.
- **The manifest now distinguishes four states:** the complete text; `null` (not a text layer); absent WITH `originalTextPreview` + `originalTextVerification` (too long to store, still fully verifiable); absent with neither (never captured - the only state that genuinely needs re-inspection). The verification record carries the inspected source's own `sourceProjectSha256`, tying the evidence to the exact immutable source it was read from.
- **The gate compares by digest when the full text is not stored**, reaching exactly the same verdicts - identical, case-only, whitespace-only, both, or genuinely different - and never emits "re-run template inspection" for a merely long text.
- **Decisions are bound to the complete text's digest.** `textDigestAtDecision` is recorded alongside `textAtDecision`, and staleness is judged by the digest whenever present, so a decision can never rest on an abbreviated rendering. Records written before this field fall back to the stored text and keep working.
- **The dashboard labels an excerpt as an excerpt**, states the complete text's length, and never uses the "Template's own text" label for it (English and Hebrew).
- **Tests added for every case the correction names:** text exactly at the limit, one character over, very long identical text, very long case-only and whitespace-only variants, a genuine difference occurring after character 10,000, an astral character straddling the boundary (both in the digest and in slice reassembly), a stale decision after a long mapping changes, and legacy manifests lacking both text and digests - plus slice-read failure paths, manifest storage states, the source-fingerprint tie, and the dashboard's excerpt labelling. A dedicated case asserts that full-text and digest comparison agree for the same inputs.
- **Results: 309 test files, 3824 tests, 0 failures. `npm run typecheck` clean.**
- **Compatibility: no database migration.** Every new field is optional; manifests, plans and completed job records written before this parse and behave unchanged. An un-updated worker simply records no digests, which the gate treats as "never captured".

### Stage 2 integrity follow-up (2026-09-19): collision-free encoding, and no remaining re-inspection loop

- **The digest now hashes UTF-16 code units, not UTF-8** (`sha256-utf16le-code-units-v1`). The previous UTF-8 encoding mapped every unpaired surrogate to U+FFFD, so a high lone surrogate, a low lone surrogate and U+FFFD produced the same digest. That collision was documented as an accepted limitation; it is now removed rather than explained. Encoding each code unit as two little-endian bytes is injective over every possible JavaScript string. Tests prove distinctness for a high lone surrogate, a low lone surrogate, a valid surrogate pair, U+FFFD, astral characters and composed versus decomposed Unicode, and prove equality for strings that genuinely are equal - all pinned against `node:crypto` fed the same bytes. The same canonical encoding is applied to the exact digest and to each normalized variant, after its own normalization step.
- **Normalization is context-free, so it streams.** Case folding is now applied per code point rather than to the whole string. Whole-string lowercasing is context sensitive (Greek final sigma), and a context-sensitive fold cannot be computed a slice at a time - the verdict would depend on where slice boundaries fell. A test asserts the documented difference explicitly, and asserts that folding a text equals folding its pieces at every chunk size.
- **Digests are computed incrementally, without assembling the text.** New `Sha256Stream` and `TextVerificationStream` consume bounded slices; a surrogate pair split across a boundary is carried inside the stream. Streamed digests equal whole-string digests at chunk sizes 1, 2, 3, 5, 17, 64 and 4,096, including boundaries that split a pair.
- **The remaining permanent loop is gone.** A text beyond `MAX_VERIFIABLE_TEXT_CODE_UNITS` (2,000,000) is no longer indistinguishable from "never captured". The manifest now records `originalTextCaptureStatus`: `COMPLETE`, `VERIFIED_EXCERPT`, `CAPTURE_FAILED` (transient - re-inspection may resolve) or `TOO_LARGE` (terminal), plus `originalTextCodeUnitLength`. The gate reports `TEMPLATE_TEXT_TOO_LARGE_TO_VERIFY` with an actionable reason - shorten the layer's text or remove the mapping - and never suggests re-inspection for it. **That state cannot be cleared with Keep Template Text either**, since nothing was verified to keep; a test asserts both decisions fail to clear it.
- **An over-sized text costs nothing to detect:** it is refused before any slice is requested when the scan already reported its size, and after the first slice when the scan under-reported it.
- **Digests written under an older algorithm still parse** but are never compared; the gate reports them as uncheckable and names re-inspection, which genuinely does resolve them.
- **Tests added at and beyond the boundary:** a text exactly at 2,000,000 code units verifies by streaming; a difference in the final ten code units of a 2,000,000-unit text is still detected; over-sized texts are classified terminally from both directions; and the dashboard shows the right actionable message for the terminal and transient states, offering no decision buttons for either.
- **Results: 309 test files, 3849 tests, 0 failures. `npm run typecheck` clean.**
- **Compatibility: still no database migration.** All new fields remain optional. Because the digest algorithm changed, any digests written by the previous build are refused rather than mis-compared, and re-inspection recomputes them; decision records carry their own digest and fall back to the recorded text when it was written under the old scheme.

## 2026-09-19 - Stage 3 of the global implementation plan: generic safe inspections

No inspection was run against the current project, session, source or working copy during implementation, and no plan revision was created.

- **One wrapper, no bypasses.** `apps/worker/src/inspection/disposable-project.ts` is the single path by which any inspection opens an After Effects project. The immutable source and the session working copy are never opened; a uniquely-named disposable copy is. Applied to INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE, INSPECT_RENDER_CAPABILITIES and the RENDER/CREATE_PREVIEW composition verifier. RUN_DIAGNOSTIC and CHECK_HEALTH open no project and stay outside it (they read logs, processes and health only).
- **Relative footage preserved.** The copy is created BESIDE the inspected file, so relative paths keep the same base directory; the directory is proven writable by creating and removing a real file there first (refusing before After Effects is involved if not); the copy's hash must equal the target's exactly; and after opening, every footage item After Effects cannot resolve fails the inspection closed rather than publishing misleading evidence.
- **Existing After Effects state is never gambled with.** A new read-only script reports the open project's path, name, item count and `app.project.dirty`. The wrapper refuses when that project is dirty, untitled, unreadable, or when the build exposes no reliable dirty flag. It never answers or dismisses a Save Changes prompt. A verified-clean saved project is reopened afterwards and its identity checked; failure to restore is reported loudly (`RESTORE_FAILED`), never hidden.
- **Closing and cleanup.** `DO_NOT_SAVE_CHANGES` is only ever issued after a script proves the open project IS this operation's own copy; otherwise it refuses and says what it found. Copy, open, inspect, close, restore and cleanup all run under `try/finally`. A copy that cannot be proven closed is deliberately left on disk (`LEFT_IN_PLACE_STILL_OPEN`) rather than deleted underneath a live handle; a copy that cannot be deleted is quarantined by exact rename; both report the exact path. There is no wildcard sweep - `findStaleDisposableCopies` only ever lists files carrying this wrapper's own `.dyo-inspect-<uuid>.aep` marker, and only reports them.
- **Integrity and concurrency.** A process-wide project-state lock is taken before any state transition and REFUSES (never queues) while another operation holds it, naming the holder. The immutable source and the working copy are hashed before and after every inspection; any change fails the inspection closed as a safety violation. Windows and POSIX paths are handled by the shape of the path itself, never the host platform, so a POSIX path is never silently rewritten.
- **Two real defects found and fixed while wiring this up.** (1) The wrapper's open call was going through the transient-retry helper, so one MCP timeout became three `app.open` calls - exactly the 2026-09-03 incident; the open is now a single direct call with a read-only poll fallback. (2) The wrapper ignored the caller's tuned open timeout and used its own 120 s, hanging fixtures for 20 s; it now honours the configured budget.
- **Behaviour changes owned, not hidden.** The "reuse whatever is already open" shortcut is gone by design: even when the requested project is already open, its copy is opened instead. The legacy "requires interactive confirmation" classification (open succeeds with no project associated) is preserved in the wrapper, and no longer needs a separate conversion copy since a disposable copy already exists. The capability inspection now names the project it inspects - the API resolves the real path and sha256 from its own project record - and a request without one fails closed instead of reading whatever After Effects holds.
- **Tests: 34 wrapper cases** covering relative-footage placement, unwritable directory, hash mismatch before opening, copy-hash mismatch, clean-project restoration, restore failure and wrong-project restore, dirty/untitled/unknown/missing-dirty-API refusals, no project open, a stale copy from an earlier run, inspection exception, close failure (file left in place), cleanup failure and quarantine, cleanup-and-quarantine failure, concurrent-lock rejection, source and working-copy post-hash mismatches, Windows path casing/separators, and the scoped stale-copy listing - plus updated failure-injection coverage across the template, scene-evidence, capability and verifier suites.
- **Results: 310 test files, 3887 tests, 0 failures. `npm run typecheck` clean.**
- **Compatibility:** no database migration. Every new field is optional (`safeInspection` on four result shapes; `projectId`/path/sha on the capability request), so stored results and older callers still parse. Deployment order: schemas, API, then a packaged worker install - and the new worker has deliberately NOT been built or installed yet.

## 2026-09-21 - Stage 4 of the global implementation plan: generic slot semantics and fit validation

No inspection was run against the current project, session, source or working copy during implementation, no plan revision was created, no render was dispatched, and no worker was built or installed. Every fixture is a synthetic composition SHAPE; the Mixkit template is a regression fixture only, and none of its names, ids, dimensions, timestamps, coordinates or hierarchy appear anywhere in the code or tests.

- **Classification from structure, never names.** `packages/schemas/src/slot-semantics.ts` classifies each slot as `device_screen` / `flat_card` / `unknown` from nesting and host depth, track-matte presence AND what the matte is made of (`RENDERED_FOOTAGE` vs `DRAWN_MASK_OR_SOLID`), 3D state, animated parent, a sibling pre-rendered beauty pass, dimensions, aspect ratio and transformed top-level bounds. The name guarantee is structural, not a convention: the winning side and the confidence come from sums that contain no name-derived term, and name evidence is collected into its own list for a human. A test flips every name in a fixture and asserts nothing changes.
- **Confidence is versioned and explicit.** `confidence = margin x mass`, with positive and negative evidence listed individually and `SLOT_SEMANTICS_MODEL_VERSION` stored alongside. Evidence substantial on both sides marks the verdict `conflicting` and caps confidence below the threshold. A low-confidence, unknown or conflicting verdict BLOCKS plan approval, execution dispatch and the complete-preview gate - never a warning - and is cleared only by an explicit, attributable human decision.
- **Every visual slot now carries a verdict.** `build-manifest.ts` previously produced slot facts only for the "screen card" shape; it now does so for every `image`/`video`/`logo`/`phone_screen` placeholder, top-level and nested alike, and `buildSlotStructuralFacts` reads a footage layer's OWN matte/3D/parent facts when the slot is a layer rather than a whole composition placed by hosts. Without that, every ordinary image slot would have been unclassifiable and permanently blocked. Text and colour placeholders are deliberately never judged.
- **Host order no longer changes a fingerprint.** Placements are sorted by composition and layer index before they are recorded: the project's own scan order is an artefact, and a fingerprint that moved with it would fail closed on a project nobody touched. Proven by a test that reverses composition and edge order and asserts identical facts and digest.
- **Asset compatibility, without filenames.** `assessAssetSlotCompatibility` takes an `AssetFacts` that has no filename field by construction. A logo does not silently enter a phone screen, a transparent asset does not enter a device screen, a full opaque screenshot does not silently enter a decorative card, a severe aspect mismatch blocks, and an undeclared role or unmeasured asset blocks rather than passing.
- **Assets are now genuinely measured.** Uploads previously stored `width: null, height: null` always - so the fit checks would have had nothing to work with. `apps/api/src/domain/asset/probe-image-facts.ts` reads dimensions and transparency out of the uploaded bytes for PNG (including palette transparency via `tRNS`), JPEG and all three WebP container shapes (VP8, VP8L, VP8X), with every read bounds-checked. Its tests run against files a real encoder actually wrote, asserting the parser agrees with that encoder's own metadata, plus truncated, mismatched-type and unmeasurable cases. Video, audio and documents stay null, and null blocks.
- **Fit is simulated before it is executed.** `assessFit` reports scale per axis, slot coverage, cropped percent, unused area and distortion for `contain`/`cover`/`stretch`, using the same `fitModeForRole` rule dispatch executes, and flags `EXCESSIVE_CROP`, `LARGE_UNUSED_AREA`, `DISTORTED` and `DIMENSIONS_UNKNOWN` - so a correct layer with a wrong fit is caught.
- **Evidence frames are mandatory, and verified.** A decision about an uncertain classification, a compatibility conflict or an unsafe fit is refused without the frame the reviewer was shown. The moment is the midpoint of the slot's own visible window - never a layer's first frame, which is routinely mid-transition - and is resolved SERVER-side from the manifest (`slotEvidenceMappingId`), never supplied by the browser. Capture runs through the Stage 3 disposable-project wrapper. The API then verifies the named frame is this scene's most recent capture, from the source the plan is bound to, with a recorded capture moment inside the slot's visible window. A slot with no provable visible moment cannot be decided at all, and says so.
- **Structure is re-proved immediately before mutation.** Each slot carries a versioned structural fingerprint and a narrower mutation fingerprint over the exact chain an edit traverses plus the slot's own geometry. Before any `MAP_FOOTAGE`, the worker re-reads the live chain and recomputes the digest; a changed layer path, geometry, matte, 3D state, parent chain or host structure fails the operation closed with nothing applied. Top-level slots are checked as a one-hop chain rather than skipped.
- **Decisions go stale by design.** Each recorded decision carries a digest of exactly what was blocking, plus who decided, when, and the evidence frame. Any new, removed or changed finding invalidates it instead of silently covering something the reviewer never saw.
- **Dashboard shows the evidence, not just the refusal.** The scene editor computes the same assessment with the same shared functions the API gate runs, against the form's current state, and keeps every decision button disabled until a frame of the slot's own moment exists - so it can never offer a decision the backend would refuse. English and Hebrew.
- **Two real product defects found while wiring this up.** (1) A deleted asset was being reported as "dimensions unknown" by the new gate instead of "no longer exists"; the clearer refusal now runs first. (2) The inspection's post-hash of the source was never compared with the pre-hash taken before the disposable copy - a source changed mid-inspection would have been recorded as a manifest of a file that no longer existed. It now fails closed.
- **Tests:** 36 classifier/compatibility/fit cases, 18 slot-facts cases, 23 readiness-gate cases, 13 approval-gate cases, 11 image-probe cases against real encoded files, plus dispatch-gate, evidence-timestamp, executor-refusal, manifest, edit-operation and dashboard cases. The fixture matrix covers rendered-matte animated screens, drawn-mask flat cards, plain 2D layers, logo and text-only placeholders, nested and reused precomps, shared sources with several parents, 2D and 3D slots, deliberately misleading names, portrait/landscape/square/transparent assets, contain/cover/stretch and excessive crop, changed fingerprints, conflicting evidence and slots with no visible frame.
- **Compatibility: two additive migrations** - `assets.has_alpha` and `scene_evidence_previews.captured_at_seconds`, both nullable, no backfill, nothing rewritten. Every new schema field is optional, so manifests, plans and job records written before Stage 4 still parse. **Behaviour change owned:** a project whose manifest predates slot discovery now blocks approval for its image mappings and names re-inspection as the fix - that is the intended fail-closed behaviour, not a regression. Deployment order: schemas, migrations, API, dashboard, then a packaged worker install.

### Stage 4 follow-up (2026-09-21): transparency is measured from pixels, and visibility from what is actually on screen

**The defect this fixes** was in my own risk report on Stage 4: `hasAlpha` conflated "this file can carry an alpha channel" with "this picture has transparent pixels". A screenshot exported as RGBA, and a palette PNG declaring a transparent colour it never uses, would both have been blocked as "transparent background" - teaching reviewers to click through a warning that is wrong most of the time. Scope is frozen after this correction; no new stage was started.

- **Four separate facts, never inferred from each other.** `hasAlphaChannel` is what the container can carry (evidence only); `hasTransparentPixels` / `transparentPixelRatio` are what the pixels actually contain; `visibleContentBounds` / `visibleCoverageRatio` are where the non-transparent content sits. A null pixel fact means "could not be decoded" - neither opaque nor transparent.
- **PNG is genuinely decoded.** `probe-image-facts.ts` now inflates the image data with Node's own zlib, reverses all five scanline filters, and reads alpha per pixel for every non-interlaced colour type and bit depth (1/2/4/8/16), including palette `tRNS`, greyscale and truecolour single-colour transparency. Interlaced, over-sized (>40 megapixels) or undecodable data returns UNKNOWN with the dimensions still reported - never a guess. JPEG and plain lossy WebP are opaque as a fact of the format. A WebP that DECLARES alpha needs a VP8/VP8L decoder this host does not have, so it is reported as UNKNOWN rather than assumed either way.
- **The rules now use pixels, not capability.** A fully opaque RGBA PNG behaves exactly like an opaque screenshot, including the "screenshot into a decorative card" check. Transparency below 2% is incidental (an antialiased rounded corner is not a see-through background) and does not block. A genuinely see-through asset in a device screen still blocks, and now says how much of it is see-through. Unknown transparency blocks a DEVICE SCREEN with `ASSET_TRANSPARENCY_UNKNOWN` - where the consequence is real - and is deliberately not held against a decorative card, so an unmeasurable video frame is not stuck behind a question that changes nothing. An unused alpha channel is reported as non-blocking evidence.
- **Fit follows the visible content.** Coverage and crop are computed from the asset's measured content bounds when they are known: cropping transparent padding is no longer counted as cropping the asset, a mostly-padding asset is flagged (`LARGE_TRANSPARENT_PADDING`) even though its file fills the slot, and a slot left half empty by the content itself is still reported.
- **Evidence-frame selection was using timing alone - corrected in this same follow-up.** `computeEffectiveVisibility` now picks the window a slot is genuinely on screen: a host counts only when it is enabled, its rendered rectangle reaches its composition's frame (computed from position, anchor and scale; left unknown for a 3D layer, whose on-screen position depends on a camera), and its opacity stays at or above 10% - interpolated across the opacity keyframes the scan now reads. The longest such window wins and the frame is taken at its midpoint, so a frame is never captured during a fade or a zero-opacity hold. Unread facts never disqualify a host; facts known to hide it do, and a slot no host presents visibly has no provable moment at all. The legacy in/out window is used only when no host reported one, so an older manifest still works while a host that was examined and found invisible is never talked back into visibility.
- **A real UI defect found by these tests:** the drawer's slot-decision handler wrote back a copy of its mapping captured at render time, which dropped the evidence frame the panel had reported asynchronously - producing a decision the API would then refuse. It now updates only the field it owns.
- **Tests:** 15 probe cases against real encoded files (opaque RGBA PNG, transparent logo, large transparent padding, palette transparency both used and unused, greyscale, 16-bit, JPEG, lossy WebP, alpha-declaring WebP, corrupted pixel data, truncated, mismatched type, unknown format), 12 compatibility/fit cases for the capability-vs-pixels distinction and content-aware fit, 9 effective-visibility cases (switched off, off-frame, 3D unknown, zero-opacity hold, fade, several hosts, unread facts, legacy fallback, no provable moment) and 6 worker-side visibility-fact cases. The palette fixtures are hand-built valid PNGs whose expected facts were confirmed independently by a real decoder (`sharp`: `hasAlpha` true, `isOpaque` true for the unused-transparency file).
- **Results: 315 test files, 4052 tests, 0 failures. `npm run typecheck` clean, `npm run lint` clean.**
- **Migrations: the undeployed `has_alpha` column is superseded, not rewritten.** Migration 0025 adds `has_alpha_channel`, `pixel_analysis`, `has_transparent_pixels`, `transparent_pixel_ratio`, `visible_coverage_ratio` and `visible_content_bounds`; 0026 drops `has_alpha`. Both are additive-then-drop on a column that was never deployed, no data is rewritten, and no pushed history was touched.

### 2026-09-22 - first real After Effects smoke test of Stage 4: four production defects found and corrected

Run against the disposable QA fixture only (`C:\DYO-Agent\qa\smoke-fixture-v4\QA-Smoke.aep`, sha256 `c1e1e4ea…`), project `d13afd58-9ea6-4315-b193-d28a43baea79`, plan revision 6, session `d1b91775-07fa-4fc5-8e37-c499ba8266c8`. The client's template, project `65e24d16…`, session `e0483ad6…` and its Revision 4 were not opened, dispatched against or modified at any point, and no render was run.

Each defect below was found by running the real thing, and none of them could have been found by a unit test: in every case the two halves of a contract were individually correct and only disagreed with each other in production.

1. **`buildProjectFacts` dropped the project scan.** It accepted `layerFactsByCompositionAndIndex`, used it internally and did not return it, so every structural verdict in production was `unknown` at confidence `0.000`. The field was optional on both sides, so the compiler said nothing and 4,075 tests passed against a feature that did nothing. The contract is now REQUIRED end to end, and an end-to-end integration test runs the real chain from raw scan JSON to slot verdicts.
2. **The QA fixture bound no mattes**, then **its two control cases shared one slot composition.** Fixture defects, corrected in v4; see `RELEASE-SMOKE-CORRECTIONS.md`.
3. **The live fingerprint check spoke a different enum vocabulary than the scan.** The scan records a track matte by its key name (`"LUMA"`); the live re-check stringified After Effects' enum object (`"6015"`). The same fact, encoded two ways, so the digests could never match and **every footage edit, on every slot, in every project, was refused** as "structure changed" on a project nobody had touched. Fixed by embedding the scan's own enum helper and key list in the chain script (`06df85a`).
4. **The live fingerprint check resolved compositions by an unstable index.** A project-item index is not stable within one job: the first `MAP_FOOTAGE` imports an asset and renumbers `app.project.item(n)`, so every LATER nested slot was refused with "chain step 0 did not resolve to a composition". The mutation path had already learned this on 2026-09-14 and resolves by the stable `CompItem.id`; the Stage 4 re-check, written later, still trusted the index. Both paths now identify a composition the same way, and descending a hop is a verification rather than the means of finding the next composition (`6dace9e`).

Both product defects failed CLOSED - nothing was ever edited wrongly, the working copy's hash stayed equal to the source's, and the immutable QA source was never modified - but together they meant no footage edit could complete at all.

**Open defect, not yet corrected (evidence legibility, not correctness).** `textDirectionEvidence` reports `appliedDirection` / `previousDirection` / `appliedComposerEngine` as raw After Effects enum values (`"10213"`, `"10413"`) rather than their key names. The verification itself is sound - both sides of the comparison are read the same way, and the smoke test's Hebrew was confirmed by code units (`textCodeUnitsVerified: true`, `codeUnitCount: 12`) - but a reviewer reading the stored evidence cannot tell that `"10213"` means right-to-left. Same family as defect 3; left alone because development scope is frozen and it blocks nothing.

- **Results after corrections 3 and 4: 317 test files, 4090 tests, 0 failures. `npm run typecheck` clean, `npm run lint` clean.**
- **The installer reported a hard-coded build tag** ("running build 8f3568a") regardless of what it actually installed, while the `BUILD_INFO.json` beside it was correct. It now reads and reports the installed commit.
- **No migration, no server change.** The classifier and both re-check scripts live in the worker; the deployed API/dashboard build (`dc14516`) is unaffected and was not redeployed.

#### Smoke-test results, 2026-09-22 (steps 2-7 on real After Effects)

Run end to end on the disposable QA fixture only. The client's template, project `65e24d16…`, session `e0483ad6…` and Revision 4 were never opened, dispatched against or modified, and nothing was rendered.

| Step | What it proves | Result |
|---|---|---|
| 2 | Inspection never touches the source | **PASS** - `sourceSha256Before` == `sourceSha256After`, disposable copy `DELETED` |
| 3 | Structural classification from real facts | **PASS** - after defect 1 was fixed, every slot carries a real verdict |
| 4 | The gates block the wrong asset | **PASS** - transparent logo into a device screen refused, screenshot into a flat card refused |
| 5 | Evidence frames show a real moment | **PASS** - captured inside the slot's visible window, never t=0 |
| 6 | One frame executes correctly | **PASS** after defects 3, 4 and 5 - 5/5 operations, source hash unchanged, working copy mutated, Hebrew verified by code units (12/12) |
| 7 | A changed template is refused | **PASS** - see below |

**Step 6, the preview itself.** The first "successful" execution produced a preview that was **fully transparent** - one colour, 0% non-transparent pixels - because EXECUTE_FRAME captured t=0 unconditionally (defect 5). After the fix the same scene resolved to t=5s and produced a real frame: 491 distinct colours, 19.2% non-transparent, showing the mapped screenshot, the logo in its card and the Hebrew branding line. The first preview was then approved by a human in the dashboard (`firstPreviewApproved: true`), never by this agent.

**Step 7, fail-closed.** One layer was added to `QA_Screen` in After Effects and the project saved, changing the source from `c1e1e4ea…` to `81b03f8c…`. Re-inspection confirmed the new hash and all four compositions. Executing the same approved scene against it was then **refused before anything was touched**:

> working copy could not be prepared (SOURCE_SHA_MISMATCH): source .aep sha256 (`81b03f8c…`) does not match the expected sha256 (`c1e1e4ea…`) - the source project has changed since this job was created; refusing to proceed

`operationsCompleted: []`, `workingProjectSha256: null` - no working copy was even created. The refusal came from the OUTER chain-of-custody gate, which fires before the Stage 4 slot fingerprint gate can be reached; that is the correct layering, and worth recording precisely because the smoke-test plan anticipated the inner gate. The inner gate's own live behaviour was demonstrated separately and for real during this same run: job `3c51e867` refused a `MAP_FOOTAGE` with "this slot's structure has changed since the plan was approved (approved `4e01d1de4315`, now `6a712b80a57b`)" and applied nothing, which is how defect 3 was found.

**What remains before MVP acceptance** (CLAUDE.md): three different plugin-free templates end to end, landscape output, native 1080x1920 Reels output, and an interrupted-job recovery test. None of those were attempted here - this smoke test covers inspection, classification, the gates, one frame and fail-closed refusal only.
