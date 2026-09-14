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
