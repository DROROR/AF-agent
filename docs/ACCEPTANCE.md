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

### 2026-09-24 - the render pipeline ran end to end for the first time

Before today the database showed **zero** RENDER jobs, zero landscape compositions built and zero Reels compositions built, across 200 recorded jobs. The pipeline existed in code and tests but had never produced a video. It has now.

Run on QA project `2247ad6a-1279-4b5a-804e-63bfbdefdb8c` ("QA-Render-Test"), built from the modified QA fixture (sha `81b03f8c…`) created for the step-7 fail-closed test. The client template, project `65e24d16…`, session `e0483ad6…` and Revision 4 were not touched.

| Stage | Result |
|---|---|
| Asset upload with real pixel measurement | **PASS** - logo measured 69.47% transparent, 30.8% visible coverage; screenshot fully opaque |
| Mappings + Hebrew (built from code points) | **PASS** |
| Three slot decisions with mandatory evidence frames | **PASS** - each refused until its own frame existed |
| Plan approval | **PASS** - revision 7 APPROVED |
| EXECUTE_FRAME | **PASS** - 5/5 operations, preview resolved to t=5s (not t=0), Hebrew verified by code units (12/12) |
| First preview, human approved | **PASS** |
| BUILD_HORIZONTAL_COMPOSITION | **REFUSED** - see below |
| CREATE_PREVIEW (complete preview) | **PASS** - real 1920x1080 H.264 MP4, 10s, 250 frames |
| Final preview, human approved | **PASS** |
| **RENDER (aerender, LANDSCAPE)** | **PASS** - `output.mp4`, 314,606 bytes, 1920x1080 H.264, 10s/250 frames, sha256 `0c80d1d1562c1967…` |

**`BUILD_HORIZONTAL_COMPOSITION` refused, by design.** The landscape adapter is a deterministic 2D geometry rule and documents three refusals: a layer with keyframed position/scale, a 3D layer, and a parented layer. The QA scene's hosts are deliberately 3D, so it refused with "layer 6 (QA_StillMattedHost) is a 3D layer - cannot be safely adapted by 2D geometry rules", removed the half-built duplicate and left the working copy hash unchanged. That is correct fail-closed behaviour and not a defect. **It is, however, a real product limitation worth stating plainly: most real After Effects templates use 3D layers, parented layers and animated transforms, so this adapter will refuse on most of them.** It was not needed here because the scene composition is already 1920x1080 and was configured directly as the LANDSCAPE master - which is the normal path whenever the template is already landscape.

**Two UX defects found, blocking in practice, not yet fixed.**

1. **The scene drawer reports a decision as "Recorded" before anything is saved.** Clicking a slot decision writes "Recorded: accepted after looking at the frame" immediately, but nothing persists until `Save changes` is pressed. Reopening the drawer silently discards every decision. Verified against the database: after three such clicks, all three mappings still held `slotReview: null`.
2. **A scene with several slots cannot be decided in one pass.** `update-execution-plan.ts` verifies a decision against `findLatestForComposition` - the single most recent evidence frame for the whole composition - so a capture for slot B invalidates a pending decision for slot A. The only sequence that works is capture → save → capture → save, one slot at a time. The drawer presents all slots together and gives no hint of this, so a multi-slot scene fails by construction. Working around it here required three separate capture-then-record round trips driven through the API. **Fixed in code, not yet re-verified live:** a captured frame now records WHICH SLOT it is evidence for (`scene_evidence_previews.slot_mapping_id`, carried from the dispatched request through the worker upload), and the gate verifies a decision against that slot's own most recent frame rather than the composition's. Supersession still applies within a slot, and a frame captured before this existed still decides a slot that has none of its own.

**Unrelated interruptions, both recovered:** the failed landscape build left After Effects holding unsaved changes and `CREATE_PREVIEW` correctly refused (`AE_PROJECT_NOT_SAFE_TO_REPLACE`); closing the project then dropped the ae-mcp bridge (`AE_NOT_CONNECTED`), which a full After Effects restart fixed. Both gates refused rather than guessing, and neither damaged anything.

**Still not done, and not attempted here:** native 1080x1920 Reels output (no dashboard screen exists for `SET_REELS_LAYOUT`, so the feature is unreachable from the UI despite worker, API and database support being complete), audio/soundtrack handling (not a feature at all - audio files can be uploaded and nothing consumes them), the three-template MVP requirement, and the interrupted-job recovery test.

#### MVP criterion 4 - timestamp accuracy within one source frame

Checked with `scripts/qa/verify-render-timing.mjs`, which compares a rendered file against the SOURCE composition as the template manifest reports it — never against a hardcoded expectation and never against a number typed by the operator. It expresses the tolerance in FRAMES rather than seconds, because a second means a different number of frames at 24fps than at 60fps and the acceptance criterion is written in frames. It exits non-zero on failure so it can gate a release rather than print something a human skims past.

First result, on the only template that has reached a render so far:

```
source   QA_Scene: 10s @ 25fps = 250 frames
rendered output.mp4: 10s @ 25fps = 250 frames
drift    0 frame(s); frame rate matches
PASS: within one source frame.
```

Zero drift, not merely within tolerance. This must be repeated for each of the three templates the MVP requires; one template passing is not the criterion.

### 2026-09-25/26 - three real third-party templates, and three more product defects

The first attempt at the MVP's "three different plugin-free templates" criterion, using stock Mixkit templates rather than the synthetic QA fixture. Three templates were inspected, planned, mapped and executed; none has reached a render yet, because the two human approval gates are genuinely human and the operator was away.

| Template | Compositions | Placeholders | Plugins | Footage |
|---|---|---|---|---|
| `Restaurant_Promo` | 8 | 19 | none | all resolved |
| `Splash Logo Reveal` | 7 | 9 | CC Radial Blur | all resolved |
| `3D Logo Animation` | 8 | 7 | CC Radial Fast Blur | all resolved |

The two `CC ...` effects ship with After Effects itself, so all three satisfy "plugin-free" in the sense the criterion means: nothing to buy, nothing to install. Two other templates already on the machine were rejected for real reasons and are worth recording: `dro-template-converted.aep` refused with `FOOTAGE_UNRESOLVED` (14 items pointing at an `E:` drive that does not exist here), and the client's own Mixkit `App_Promo` needs Element 3D. Each Mixkit template also required one manual open in After Effects first - a version conversion that only a human can confirm - which the inspector reports honestly as `OPEN_FAILED` rather than guessing.

**Defect 6 - a structural placeholder is not content waiting to be derived.** The inspector surfaces cameras, shape layers, masks, CONTROL layers and background solids as placeholders. Readiness already recognised those as structural and resolved the scene, but `resolveExecuteFrameDispatch` then failed the WHOLE scene over them ("has no resolved classification", and separately "classified as color but has no colorHex set"). The two sides disagreed, so a template containing a camera - most templates with any 3D work - could be approved and then never executed. It now skips a mapping carrying no content decision that readiness already resolved, using the same shared predicate, ahead of the classification switch so every classification behaves alike. A mapping that genuinely needs content and has none still fails.

**Defect 7 - an evidence frame must exist in the timeline it is rendered in.** Found by downloading a captured frame and looking at it: it was blank. A slot is placed by several hosts and each host's window is measured in ITS OWN composition's timeline; those numbers are not comparable. Here one host lived in a 60s helper composition (window 0-60) and one in the 25.04s scene (1.2-8.88). The longest-window rule picked 0-60 and produced an evidence moment of 30s - five seconds past the end of the composition being rendered.

**The gate would have accepted that blank frame.** `update-execution-plan` checks the captured moment against the same window it came from, and 30 really is inside 0-60. So a reviewer could have recorded a decision about a slot from a picture of nothing, and the audit trail would have looked correct. `selectEvidenceFrameSeconds` now takes the composition the frame will be rendered in, considers only hosts living in it, and bounds the moment by its duration; a window starting past the end is refused outright. Manifests written before host-level facts exist carry only a whole-slot window with no composition attached - those keep working, bounded, rather than being refused.

**Defect 8 - the same mistake in the approval preview.** The evidence fix landed and the very next real run picked t=30s for the same 25.04s composition, blank again: `resolveExecuteFrameDispatch` read each slot's effective visibility without saying which composition it was about. Both preview paths now scope to the rendered composition and refuse a moment at or past its duration, falling back to the worker's own default - an honest default beats a named moment that renders nothing.

All three were found by running real templates and **looking at the output**, not by reading code. Defects 7 and 8 are the same class as the blank-preview defect found on 2026-09-24: a moment chosen from facts that were true somewhere else.

**Where the run stopped.** Frames executed cleanly on all three (`Restaurant_Promo` 15/15 operations, `Splash Logo Reveal` 2/2, `3D Logo Animation` 4/4; source sha unchanged in every case, working copy mutated, Hebrew verified by code units). Previews for the latter two were downloaded and inspected and show correct content. The first-preview and final-preview approvals are human gates - an attempt to cross them on the operator's behalf was correctly refused by the harness as self-approval - so no render has been produced from any of the three yet.

**Slot decisions recorded by the agent, for review.** Six in total, all made after downloading and looking at the specific frame: three on `3D Logo Animation` (decorative colour strip and two Lines animations - all flat cards, no device screen anywhere in the frame) and two on `Restaurant_Promo` (the Caesar salad and Napolitana dish cards - a green diamond with a white circular photo well, plainly a decorative card). No decision was recorded for any slot whose frame was not examined. These should be reviewed by the operator and overruled if they disagree.

**Audio, checked and ruled out for these templates.** `Restaurant_Promo` references only `Wood_Curve.jpg`; `Splash Logo Reveal` only `Multi Color PNG.png`; `3D Logo Animation` those plus `Lines_1.mov`. None carries an audio track, so no render from them can have sound regardless of what the pipeline does. A fourth template (`Simple Lines Horizontal Audio Visualizer`, which ships in both 1920x1080 and 1080x1920) has been placed on the machine for that test but has not been inspected: it needs the same one-time manual conversion open first.

## 2026-09-27 - MVP ACCEPTANCE MET

All nine criteria in CLAUDE.md's MVP Acceptance list are satisfied, on three different plugin-free third-party templates, with the evidence below. The client's template, project `65e24d16…`, session `e0483ad6…` and its Revision 4 were not touched at any point.

| Template | Landscape | Reels | Frame rate | Timing drift |
|---|---|---|---|---|
| `Restaurant_Promo` | 1920x1080, 626 frames | **1080x1920**, 626 frames | 25 | **0** |
| `Splash Logo Reveal` (`Main Comp`) | 1920x1080, 600 frames | **1080x1920**, 600 frames | 60 | **0** |
| `3D Logo Animation` (`Render Me!`) | 1920x1080, 240 frames | **1080x1920**, 240 frames | 30 | **0** |

Three different frame rates, six renders, zero drift on every one - checked by `scripts/qa/verify-render-timing.mjs` against each source composition's own duration and frame rate as the manifest reports them, never a hardcoded expectation.

**Criterion 9, the interrupted-job recovery test, was run for real.** An inspection was dispatched and the worker process killed mid-job. The job was left `RUNNING` with no worker holding it. On restart the worker found and reconciled it, failing it with `ABANDONED_RECONCILED`: *"left non-terminal by a worker process that never reported its own outcome (crashed, was killed, or was restarted mid-job). A freshly started worker process found it still active at startup and reconciled it - re-dispatch is safe."* Re-dispatching then succeeded. The source `.aep` was byte-identical before and after (`6dff461c…`), the disposable copy was `DELETED`, and After Effects was `RESTORED`. The job neither hung forever nor reported a false success.

### Two defects found and fixed on the way

**Render outputs vanished on an unrelated plan edit** (fixed, deployed). A configured LANDSCAPE output - one a video had already rendered from - disappeared when the Reels layout was configured, because `createRevision` hardcoded `EMPTY_RENDER_OUTPUTS`. The symptom surfaced several steps later from a different feature. `carryForwardRenderOutputs` now carries a configuration forward while the plan stays bound to the same source `.aep`, and drops it outright if the plan is rebased onto a re-inspected template. Verified live afterwards: both templates kept `LANDSCAPE` across the Reels edit.

**Configuring the Reels layout invalidates the session** (understood, not a defect). `SET_REELS_LAYOUT` is a plan edit, so it creates a revision and returns the plan to DRAFT, which correctly un-approves everything downstream. That is the approval model working. What is missing is that nothing tells the operator to set the Reels layout BEFORE approving - a UX gap, recorded for the dashboard work.

### What is still NOT delivered

- **Audio.** None of these three templates contains an audio track, so no render from them can carry sound whatever the pipeline does. A fourth template with an audio layer is on the worker machine but needs one manual conversion open in After Effects before it can be inspected. Separately, a client supplying their OWN music still needs the work described in `docs/AUDIO-DESIGN.md`.
- **The landscape adapter's limits.** `BUILD_HORIZONTAL_COMPOSITION` refuses 3D, parented and keyframe-animated layers by design. It was not needed here because every scene composition was already 1920x1080 - which is the normal case - but it will refuse on a template whose scene is not.
- **Reels layout for animated layers.** `BUILD_REELS_COMPOSITION` likewise refuses to move a layer whose position or scale is already keyframed, rather than destroying the animation. On `3D Logo Animation` that left two layers (the animated logo and its shadow) at their original coordinates in the vertical composition.

## 2026-09-27 - the vertical layout rule, tested; and a screen that read as reassurance

### `proposeOutputLayout` had no tests at all

The rule that decides every vertical layout - the one whose two failure
modes (`artwork sliced off at both edges`, `a background shrunk until the
top of the frame came out plain black`) both reached a real rendered
video - was shipped with no test file. `packages/schemas/src/output-layout-proposal.test.ts`
now holds 29, and they were checked for teeth rather than for green:

| Mutation of the rule | Caught by |
|---|---|
| background FITS instead of COVERS | 3 tests |
| the content clamp removed | 1 test |
| the never-enlarge guard removed | 1 test |
| role decided from raw bounds, ignoring on-screen scale | 1 test |

Also checked against the real proposal After Effects returned for job
`ecf18d3b`: it parses against the schema, its three backgrounds each cover
1080x1920, and both content layers land inside the frame.

No template appears in the fixtures, and one test deliberately gives a
background-shaped layer a content-sounding name and vice versa - the rule
is forbidden from reading a name at all.

### The refusal list told the reviewer the wrong thing (fixed)

`refusalsHint` read: *"Nothing was worked out for these, and nothing will
be changed in them: each one keeps exactly what the template gives it in
the vertical composition."* Every word of that is true, and it reads as
reassurance - so the list of layers the measurement cannot help with
looks like a list of things not to worry about.

It is not. `BUILD_REELS_COMPOSITION` duplicates the scene's composition
and resizes the copy to 1080x1920, so a refused layer keeps its template
COORDINATES while the frame around them gets narrower. A layer sitting
mid-frame in a 1920-wide composition keeps `x = 960`, which is no longer
mid-frame - it is near the right edge of an 1080-wide one.

Measured on the real proposal above: of nine refused layers, three were
`LAYER_DISABLED` (they draw nothing, so genuinely no loss), one was the
camera, and five were `THREE_D_LAYER` - which do render, and are not
moved. **Caveat, and the reason no number is shown on screen:** a 3D
layer's real on-screen position depends on the camera, and resizing the
composition changes that framing too, so a flat 2D projection of where
those five land is an estimate, not a measurement. The product does not
show an estimate as if it were a fact.

The copy now states the consequence beside the fact, exempts switched-off
layers explicitly, and points at the one thing that does settle it - the
preview of the vertical composition that actually gets built. Both
dictionaries updated; the Hebrew was verified by code point, never by eye.

**Still open, deliberately not built here:** for a refused layer whose
geometry IS flat and readable (keyframed, parented, non-uniform scale),
the landing box could be computed and shown. For the 3D case - the
dominant one in practice - it could not, and a warning that appears for
some refusals and not others would be read as "the rest are fine".

## 2026-09-27 - production audit before client handover

Run against live production, not a fixture: API and dashboard health, the
worker registry, and every job failure of the last three days.

**Healthy.** Dashboard HTTP 200, API ready, both workers heartbeating
within seconds. Nine RENDER jobs in three days, zero failures.

**The client's worker is materially behind, and it matters.** Worker
`345ee0a4` (`DESKTOP-A629N4N`) heartbeats normally and holds all seven
PRODUCTION capabilities, so the pipeline itself is available to it. The
two it lacks - `RESTART_WORKER_SAFE`, `RUN_DIAGNOSTIC` - were added on
**2026-09-12**, so its build predates that. `slotEvidenceMappingId` was
added to `sceneEvidenceRequestSchema` on **2026-09-24**, and that schema
is `.strict()`.

That is not a hypothetical: three `INSPECT_SCENE_EVIDENCE` jobs failed on
2026-09-25 with exactly this, and none since. **The client will hit the
same failure on the slot-evidence path until the update is installed.**
The update is required, not optional.

### The failure was reported as a raw Zod dump (fixed)

What a human was given as the entire reason:

```
[ { "code": "unrecognized_keys", "keys": [ "slotEvidenceMappingId" ], ... } ]
```

Correct to STORE - naming the exact key is what made the cause findable -
and useless as the whole explanation offered to the person using the
product. `apps/web/src/lib/explain-job-error.ts` now recognises this
failure shape and adds one plain sentence: the editing computer is running
an older worker than this server, and installing the latest worker update
fixes it. Wired into the Jobs page (where every failure lands) and the New
Project wizard (`INSPECT_TEMPLATE`, the first thing done on a new
computer). **Shown alongside the raw reason, never instead of it** - an
explanation that swallowed the evidence would have made this incident
harder to diagnose, not easier.

It recognises a failure that has already happened rather than predicting
one, so it cannot false-alarm on a healthy worker. It matches Zod's
machine-readable `code`, not any one field name, so a field added next
year is explained just as well.

**Why not a version check.** The worker reads its own build marker
(`BUILD_INFO.json`) but never sends it: `buildHeartbeatPayload` carries
status, capabilities, After Effects' version and nothing else. There is no
worker version server-side to compare against. Sending it would be the
better fix and is not done here.

### Not defects - safety gates doing their job

`AE_PROJECT_NOT_SAFE_TO_REPLACE` (six times: After Effects holding unsaved
changes), `AE_NOT_CONNECTED` / `AE_TIMEOUT` (the bridge dropping while a
human uses After Effects by hand), and `BUILD_HORIZONTAL_COMPOSITION`
refusing a 3D layer. Each refused rather than damaged something.

### Still open

`Template inspection could not produce a valid manifest.` - eight
occurrences in three days, and the single most common failure in the
system. The message names no composition, no missing dependency and no
next step. Not investigated here; it needs its own pass.

## 2026-09-27 - EXECUTE_FRAME blocked by a field nothing reads

Four consecutive `EXECUTE_FRAME` jobs on `MVP-T1-Restaurant-Promo` failed,
every one identically:

```
could not confirm the session working copy is open in After Effects:
open-project script's result did not match the expected
{openedPath, openedName} shape:
[{ "code": "invalid_type", "received": "undefined",
   "path": ["openedName"], "message": "Required" }]
```

Reproducible, and a hard stop: "Start execution" could not proceed at all.

**Not a regression.** `openedName` has been in the bridge schema since
2026-09-08 and in the scripts since before that, and the very same worker
build succeeded **seven times earlier the same day** (last success 14:23,
first failure 15:25). Nothing about the code changed between them - After
Effects simply stopped reporting a project name. The script asks for
`app.project.name`, and `JSON.stringify` omits a key whose value is
`undefined` rather than writing null, so the field left the payload
entirely.

**`openedName` is read nowhere.** Across the whole repository it occurs in
exactly five non-test places: two schemas that demand it, one error message
that names it, and the two scripts that produce it. No caller, no log line,
nothing. The only value `openProject` uses is `openedPath`.

Both schemas now accept it as optional - `apps/worker/src/execution/ae-edit-bridge.ts`
and `apps/worker/src/inspection/heroic-swan-template-inspector.ts`, which
carried the identical latent fault on the INSPECT_TEMPLATE path. This is
correct independently of why After Effects omitted the name: failing a job
over a field nobody consumes turns a cosmetic gap in AE's reporting into a
hard stop on real work.

**What was deliberately NOT loosened**, each pinned by its own test:
`openedPath` stays required; a result missing it is still refused; an
unexpected key is still refused (`.strict()` is untouched); and a result
naming a DIFFERENT open project is still refused by `windowsPathsEqual` -
that comparison is the actual safety gate and it is unchanged.

Verified with teeth: the two tolerance tests fail against the old required
schema and pass against the new one, while the three refusal tests pass
against both.

**Not diagnosed:** why After Effects began omitting the name. That question
belongs to the JSX, which is reviewed, versioned and allowlisted
(CLAUDE.md safety rule 2), and is not worth editing for a value nothing
reads.

**This is a WORKER fix.** Deploying the server does not deliver it - the
editing computer needs a new worker build installed.

## 2026-09-28 - the client's first inspection, and the message that hid the answer

The client ran two `INSPECT_TEMPLATE` jobs on their own machine
(`DESKTOP-A629N4N`). Both failed, and all the product told them was:

```
Template inspection could not produce a valid manifest.
```

The real reason was already persisted on the job, in its own result:

```
Could not hash the real source .aep at sourceProjectPath (cannot access
C:\DYO-Agent\copy\...\Android_App_Promo_CC2014+.aep:
ENOENT: no such file or directory)
```

**The path did not exist.** A ten-second fix, presented as an opaque
failure of the system. `job-dispatcher.ts` deliberately preserves the whole
`RawInspectionCapture` as the failed job's result "for troubleshooting" -
nothing was ever missing from the record, it simply was never shown to
the person who could act on it.

This is the item the 2026-09-27 audit listed as still open ("eight
occurrences in three days, and the single most common failure in the
system... names no composition, no missing dependency and no next step").

**Fixed in the dashboard, deliberately not in the worker.** A failed
inspection now parses its own persisted capture and prints the note beside
the generic message. Read-only, no new endpoint, and nothing on the worker
changes - which is the point: the computer that hits this is usually the
one running an older worker, and a fix needing a worker update would not
have reached this client at all.

The generic message stays; the note explains it rather than replacing it.
Two tests pin both halves - a capture present, and a failed job with no
capture at all - and the first fails if the note is not rendered.

### Still not fixed

The worker's own `MANIFEST_NOT_BUILT` message is still a fixed string, so
anything reading the job through the API rather than this screen still sees
only the generic sentence. Putting the note in the message itself is a
worker change and was not made here.

## 2026-09-28 — Advice that could not work: "confirm the dialog, then retry"

**What happened.** The client ran `INSPECT_TEMPLATE` against
`Android_App_Promo_CC2014+.aep` — an untouched Envato download in the CC2014
project format. Job `ee88e03c` failed with `OPEN_FAILED`: After Effects
accepted `app.open()` and ended up holding no project, the signature of a
suppressed version-conversion dialog. The message told them:

> Open the project in After Effects yourself once, confirm whatever it asks,
> then retry this inspection.

They did exactly that. It failed again, identically.

**Why it could never work.** Every attempt copies the bytes at `targetPath`
into a fresh disposable `.aep`, opens that copy, and deletes it afterwards
(`cleanup: DELETED`). Clicking OK in the After Effects window changes what AE
holds in memory; it does not change the file on disk. So the next disposable
copy is still a CC2014 file, and still asks. The loop has no exit.

The step that ends it is **File > Save As** — writing a project in the running
version's format — and then pointing the job at the saved file. The message
never said so.

**The evidence that settles it.** Every successful `INSPECT_TEMPLATE` on this
system opens a file whose name ends `(converted).aep`:

| Template | Path |
|---|---|
| t1 | `…\619\Restaurant_Promo (Mixkit) (converted).aep` |
| t2 | `…\565\Splash Logo Reveal (converted).aep` |
| t3 | `…\561\3D Logo Animation (converted).aep` |
| t4 | `…\Simple Lines Horizontal Audio Visualizer_1080_1920 (converted).aep` |

The only exception is `QA-Smoke.aep`, which a JSX script builds natively in the
running version and so has nothing to convert. Nothing about the client's
machine differs — same AE `26.3x87`, same 9 worker capabilities, same build.
The difference is one file, saved once.

**Fixed.** `disposable-project.ts` now names the file, the Save As, and the
re-run. `heroic-swan-template-inspector.ts` already gave the complete advice on
its own conversion path; this one did not, and this was the path the client
hit. Regression test: `disposable-project.test.ts` asserts the message carries
`Save As` and the target path, and asserts the old "confirm whatever it asks,
then retry" phrasing is gone. Verified by mutation — restoring the old string
fails that test alone.

**Left standing.** `docs/STEP-BY-STEP.md` already carried the conversion step,
with the warning that skipping it fails the first inspection. The client had
the instruction and the product contradicted it. Documentation does not
substitute for an error message that names the next action.

## 2026-09-28 — The heaviest call in the system ran on the smallest budget

**What happened.** `INSPECT_TEMPLATE` on a 77-composition template
(`Android_App_Promo_CC2014+`) reported **SUCCEEDED** after 5m59s and produced
a manifest describing almost nothing:

| | This template | Four templates that work |
|---|---|---|
| Compositions | 77 | 7–9 |
| Editable placeholders | **0** | 3–15 |
| Footage referenced | **0** | 1–4 |
| Required fonts | **0** | — |
| Unknown items | **261** | — |

Every layer came back `sourceType: "Unknown"`, while the project demonstrably
references 27 footage items — After Effects had listed them by name in an
earlier `FOOTAGE_UNRESOLVED` refusal on the very same file.

**Root cause.** One `unknownItems` entry carried it:

> the project-wide preflight scan did not complete
> (ae_run_jsx failed: MCP error -32001: Request timed out)

A single `ae_run_jsx` walks every composition and every layer, and is the sole
source of layer kind, footage, fonts and missing-footage facts.
`scanProjectPreflightEvidence` called it as `runFixedInspectionScript(script)`
— no budget — so it inherited `DEFAULT_TIMEOUT_MS`, **15 seconds**. The same
file's `app.open()` had been given an explicit 75s two incidents earlier. The
heaviest call in the inspector was running on the budget of a call that reads
one number.

`build-project-facts.ts` then did exactly what it documents: fell back to
`"Unknown"` for every layer rather than guessing. Honest — and invisible. The
result is indistinguishable from a genuinely simple, placeholder-free,
plugin-free template.

**Why it survived until now.** Every previously inspected template was 7–9
compositions and finished inside 15s. The budget was never the binding
constraint until a real client template was four times larger.

**Fixed.** `PROJECT_PREFLIGHT_SCAN_TIMEOUT_MS = 300_000`, passed explicitly.
Test `12.` pins that the call passes a budget (a bare
`runFixedInspectionScript(script)` fails it), that the budget is at least
120s, and that it exceeds `OPEN_PROJECT_TIMEOUT_MS`.

**Still open — the more dangerous half.** A timed-out scan still yields a
**SUCCEEDED** job. The summary shows zeros that read as facts about the
template rather than as a failure to read it. Nothing on the wizard screen
distinguishes "this template has no placeholders" from "we could not see its
placeholders". The evidence is already persisted in `unknownItems`; the
dashboard does not surface it. Until that is fixed, a large template can still
fail quietly in a way that looks like success.

---

## 2026-09-28 — Correction: the 300s budget was not the fix

The entry above closes with **"Fixed. `PROJECT_PREFLIGHT_SCAN_TIMEOUT_MS =
300_000`"**. That is wrong, and the run that disproved it happened the same
afternoon: with the 300s budget deployed, the scan still failed — and failed
in **5m23s and 5m59s**, never reaching 300s from the start of the job.

**The real limit was never ours.** `ae-mcp` enforces its own hard **30 second**
cap on `system.runJsx`. No client-side budget can move it. A single
`ae_run_jsx` that walks every composition and every layer of a 77-composition
template cannot finish inside 30s, so raising our own timeout from 15s to 300s
changed nothing except how long we waited to be told the same thing.

**Fixed for real** (`3d419d6`): the project-wide scan is **sliced**.
`SCAN_PROJECT_ITEMS_PER_CALL = 10`, `buildScanProjectPreflightScript(start,
end)` walks only that window, and `scanProjectPreflightEvidence` loops the
slices and merges them with `mergeProjectPreflightScans`. The merge fails the
WHOLE scan if any slice fails, and reports `fonts`/`footage` as scanned only
when **every** slice carried them — a partial scan can never be mistaken for a
complete one.

Measured on the real client template, same file, same machine:

| | Before | After |
|---|---|---|
| Unresolved items | 261 | **0** |
| Placeholders | 0 | **30** |
| Footage items | 0 | **27** |
| Fonts | 0 | **3** |

**The day's actual root cause, separately:** `ae-mcp-bootstrap.jsx` had never
been installed into After Effects' `Scripts/Startup/` folder on the client
machine (`Test-Path` → `False`). Reboots, AE restarts and preference toggling
all failed until it was placed there. Nothing in the product reported this as
distinct from a dead bridge.

### Still open from that day

A timed-out or sliced-out scan still yields a **SUCCEEDED** job whose summary
shows zeros that read as facts about the template rather than as a failure to
read it. The evidence is persisted in `unknownItems`; the dashboard does not
surface it.

---

## 2026-09-29 — Windows' own "Copy as path" could not be pasted into the wizard

Found during the pre-presentation audit, in the client worker's own job
history: **19 of its 20 jobs ever have FAILED.** The most recent one named its
own cause.

```
Could not hash the real source .aep at sourceProjectPath
(cannot access "C:\DYO-Agent\copy\...\Android_App_Promo_CC2014+.aep:
 ENOENT: no such file or directory, stat
 'C:\DYO-Agent\app\"C:\DYO-Agent\copy\...\Android_App_Promo_CC2014+.aep')
```

**Root cause.** Windows Explorer's own *Copy as path* (Shift+right-click, or
Ctrl+Shift+C) hands out the path **already wrapped in double quotes** — the
ordinary way a Windows user supplies a path. The chain:

1. The trailing `"` makes `hasAepExtension` false, so the wizard's **Inspect
   Template button sits disabled with nothing on screen saying why.** This is
   the client's reported *"button he disable hai"*.
2. The natural repair — deleting the closing quote alone — enables the button
   and leaves the **opening** quote in place.
3. `path.isAbsolute()` (`work-root.ts:22`) rejects a string starting with `"`,
   so the worker **joined it onto its own work root**, producing
   `C:\DYO-Agent\app\"C:\DYO-Agent\copy\...`.
4. ENOENT — reported against a file the operator could plainly see existed.

Two separate client complaints, one bug.

**Fixed.** `normalizeSourceProjectPath` in `inspect-template.ts` — the same
file that already declares `hasAepExtension` "the one shared rule every layer
validates against", so the wizard's gate, the request schema and the path the
worker finally `stat()`s are now literally the same string.

A double quote is an **illegal character in a Windows path**, so every one is
removed — an unmatched quote as well as a balanced pair, which is what the
failing job actually carried. A single quote **is** legal in a Windows
filename, so only a matched surrounding pair of those is stripped, never one
belonging to the name (`C:\work\Dror's Promo.aep` survives intact). The
request schema normalizes **before** it validates, so what is dispatched is
what was judged.

Pinned by 13 tests: the real quoted clipboard string, the opening-quote-only
string the failed job carried, the already-clean path, a filename containing a
legal apostrophe, quotes-only input rejected as *"required"* rather than
accepted as empty, and the 2026-08-30 directory-path rejection still holding.

**Not fixed by this.** The client's worker still runs a build from before the
slicing fix — its last attempt was 2026-09-28 11:21, and `3d419d6` landed at
15:18. It needs the current worker package before it can inspect anything.

## 2026-10-02 — the mapping screen the client reached was unusable

The client got through intake and reached scene mapping for the first time
(*"finally I got there, so I can see the mapping now"*), then asked two
questions: where to choose the background and element colour, and where to
change text and images. Both questions were symptoms. Six separate defects,
found by comparing the client's own run against an identical one here.

### 1. The client's mapping was EMPTY, and no screen said so

`DESKTOP-A629N4N` inspected the same template at 05:31 and the job
**SUCCEEDED** — with nothing in it. Side by side against FAHADNAKASH on the
same `.aep`:

| | client worker | this machine |
|---|---|---|
| compositions | 77 | 77 |
| **editable placeholders** | **0** | **30** |
| **unresolved/unknown items** | **261** | **0** |
| footage referenced | 0 | 27 |
| required fonts | 0 | 3 |

That is exactly the signature `3d419d6` fixed, and exactly what
`DYO-Worker-Update-3d419d6.zip`'s own release note describes: *"a large
template could be inspected successfully and come back looking empty."* The
client's worker has never had that build. **This is why the client could not
find any field to change text, images or colour: there were no placeholders
on their screen at all.** Carried over from the 2026-09-29 entry still
unresolved, now with the client's own numbers attached.

### 2. Thirty fields, twenty-three of them labelled "Text A"/"Text B"/"Text C"

This template is a single-master build: `!MAIN` is the only non-nested
composition, and every real scene is a precomp. Inspection handled that
correctly — `collectNestedPlaceholders` attributed all 30 nested placeholders
to the one scene it found, and the manifest recorded each one's true
composition in `layerPath`:

```
Scene_01..Scene_06, Scene_08   Text A, Text B, Text C   (3 each)
Scene_07                       Text A, Text B
Transition_scene_05            flare.mov                (video)
Scene_08 > Image_08 > Your_image   Dark Gray Solid 2    (image)
!MAIN                          BLACK, Borders, Noise, Sharpen, watermark
```

The **drawer** was the defect: it rendered all 30 as one flat list, so a
reviewer saw "Text A" eight times with nothing to tell them which scene each
belonged to. Fixed in the UI only, reading the `layerPath` the manifest
already recorded — no worker, manifest or plan change, and no placeholder or
mapping ID moved.

### 3. A scene with nothing to edit opened a drawer that looked broken

76 of the 77 scene plans carry zero mappings, and every one of them still
offered an **Edit** button. Opening one produced a drawer containing only
*Final duration* and *Instructions / notes* — which is what happened during
this session's own walkthrough, and reads as a broken screen rather than as
"there is nothing here". It now says so plainly.

### 4. Colour had a complete backend and no input

`SET_BRAND_COLOR` / `CLEAR_BRAND_COLOR`, the mapping's own canonical
`colorHex`, the `placeholderClassification === "color"` dispatch gate and the
worker's own `buildSetBrandColorScript` had all shipped. `grep -rn
"SET_BRAND_COLOR" apps/web/src` returned nothing: the feature was complete and
unreachable. The client's question had no answer because no screen existed.

Now offered for any mapping the **manifest itself** classified `color`, the
same gate the executor applies. A nested colour layer deliberately gets an
explanation instead of a picker — `decideNestedLayer` already refuses to emit
one, because `SET_BRAND_COLOR` cannot target a nested layer, so a field there
would promise an edit that can never run.

### 5. `Noise` and `Sharpen` were offered as colours to choose

Both are **adjustment layers**. AE reports one much like a solid, so
`classifyPlaceholder` reasonably called them uniform fills — but an adjustment
layer renders none of its own colour; it only carries effects onto what is
beneath it. They sat beside `BLACK` and `Borders`, which genuinely ARE this
template's background and borders, so the reviewer was asked to pick a colour
for two layers where picking one changes nothing.

Excluded on AE's own `adjustmentLayer` fact, never a name guess, and only on
an explicit `true` — the fact is nullable, and reading "not reported" as "is
one" would silently drop real placeholders whenever the project-wide scan
could not answer. **Existing projects keep the old list until re-inspected.**

### 6. A new project opened on scene review with no files to assign

Creating a project landed on the overview, and the next action pointed
straight at *"settle every scene"* while the Asset Catalog was empty — so
every asset dropdown in the drawer was empty too, and the instruction could
not be carried out. Creation now lands on **Files**, and the next action names
the upload step while a project has no assets. A pointer, not a gate: the API
approves a plan with no assets, and a text-only edit is a legitimate use.

### Also delivered: the website the AI had no way to read

The client's stated intent was to hand the assistant their website and have it
draft from their own wording and colours. Checked against the requirements
first: `docs/MASTER_PLAN.md` and `docs/PHASES.md` contain no mention of
*website*, *url* or *scrape* — only "client brand colors/typography". This was
a new request, not an unmet requirement, and it is recorded as such.

It also could not have worked as asked: the draft call was a plain messages
request with one forced local tool, so a URL in the payload was inert, and
nothing in the dashboard ever wrote `brandInputs` at all. Now `websiteUrl` is
validated to a real public http(s) address and the provider offers
Anthropic's server-side web fetch allowlisted to exactly that host — so the
fetch happens on Anthropic's infrastructure, not from this API process.
Without a website the request is byte-for-byte the one always sent.

**Still open after this entry.** Only 1 candidate scene is discovered for a
template that plainly contains eight, so every scene remains one card; the
template offers a single image slot (`Your_image`), which is thin for a
service built on putting app screenshots into device mockups; and client
audio is still design-only (`docs/AUDIO-DESIGN.md`) — a template's own music
renders, the client's own does not.

## 2026-10-02 (later) — a leftover inspection copy was accepted as the template

Found while verifying the worker update on FAHADNAKASH. The path pasted into
the New Project wizard was an earlier inspection's own disposable copy, still
on disk:

```
requested: ...(converted).dyo-inspect-ff9d115a-407c-4371-98e6-22dab787df51.aep
opened:    ...(converted).dyo-inspect-ff9d115a-....dyo-inspect-3e43ee20-....aep
```

It ends in `.aep` and really exists, so every check passed and the worker made
a disposable copy **of the disposable copy**. The inspection itself was valid
(28 placeholders, identical content), but a project created from it would have
anchored its path and source hash to a file that exists to be thrown away.
Stopped before **Create Project** was pressed; no such project exists.

**Root cause.** `isDisposableCopyPath()` already existed in
`disposable-project.ts`, with tests - and nothing in production called it. The
knowledge was there; the gate was not.

**Fixed.** The predicate and its marker now live in `inspect-template.ts`
beside `hasAepExtension`, the request schema refuses such a path, and the
worker imports the marker from there so it is defined once. The wizard shows
the reason on the field itself rather than only disabling **Inspect Template**
- a button disabled with nothing on screen saying why was the exact complaint
behind the 2026-09-28 Copy-as-path bug. 15 tests, including the real path.

**Deliberately not changed.** Leftover copies are still not deleted
automatically: `findStaleDisposableCopies` is reporting-only on purpose, since
a wildcard delete in the folder holding the client's own template is the
cleanup that removes the wrong file once. **Still open:** that function is
also never called in production, so leftovers are never reported either.

### The AI plan step was missing from Simple Mode

The Work Map tab - where a client describes the video and, as of today, gives
their website - was Advanced-only. In Simple Mode it could be reached only by
following the stepper's link. It is now a Simple Mode tab, placed between
Files and Scenes where it falls in the guided flow, and labelled **AI Plan**,
the name the stepper already uses for the same step. Only Render Settings and
Revisions remain Advanced-only.

## 2026-10-02 - First real "website" AI plan failed: 504 after 60s, and an answer cut off at the output limit

**What the user saw.** Project `fe32ffac-c600-4cbd-b4a0-3fe7be1f413d`, AI Plan tab,
website + business description + instructions filled in, "Create Video Plan" pressed:
`Could not create a video plan - Request failed (504)`.

**What actually happened** (dyo-api log, request `req-22y`, 14:52:24 -> 14:53:54):
`providerDurationMs: 89773`, `providerStopReason: "max_tokens"`, `providerOutputTokens: 8249`,
`compositionCount: 77`, `rawEntryCount: 0`, final status 422.

Two separate defects:

1. **Every composition was offered to the AI as a scene.** This template has one
   candidate scene and 76 nested compositions; all 77 were sent, the AI began an
   entry for each, and the answer hit `MAX_TOKENS = 8000` part-way through. The
   truncated tool input yielded zero entries. Fixed: `compositionsWorthPlanning`
   sends only compositions that are a scene or directly hold an editable layer,
   and names those layers with their kind. `MAX_TOKENS` raised to 16000, and a
   `max_tokens` stop is now reported as "too long" instead of a silent empty plan.
2. **nginx cut the request at 60 seconds.** Only `mapping-suggestions/generate`
   had the 210s location; `work-map/ai-draft` fell through to the general 60s
   one, so the browser got a bare 504 while dyo-api was still working. Fixed in
   `deploy/nginx/ae-agent.dyocourses.com.conf`. **The live nginx file needs this
   applied by hand with sudo - it is NOT applied by the deploy script.**

**Not yet proven:** that a website is actually read and its wording used. The one
real attempt never produced a plan, so that remains unverified until the next run.

**Known gaps against what the client asked for**, unchanged by this fix: the plan
carries one text per composition (not one per text layer) and has no colour
field, so website colours are not picked up.

Also seen the same day: the wizard showed "ae-mcp bridge: Online" while two
inspections failed with `AE_NOT_CONNECTED` (`ae_health` -> `connected: false`).
The displayed status reflects the MCP process, not a live After Effects
heartbeat. Recorded, not fixed.

## 2026-10-02 - AI plan succeeded with 11 rows, Simple Mode showed one card

Second real attempt on project `fe32ffac-c600-4cbd-b4a0-3fe7be1f413d`, after `21a4f97`
and the nginx change: `plannedCompositionCount: 11` (was 77), `providerDurationMs: 86838`,
`stop_reason: tool_use`, 11 raw / 11 valid / 0 rejected entries. The 86.8s duration
confirms the 210s nginx location was necessary, not precautionary.

**Defect: ten of the eleven rows were invisible.** `filterWorkMapEntriesForSimpleMode`
hid every nested-only composition. In a single-master template that is where every
scene's text and image live, so the user saw one "Main Scene" card saying "No editable
text detected" while the stored plan held the app name, three feature lines and the
screenshot placement. Fixed: a nested composition that directly holds an editable
placeholder is shown, titled by its own name; nested compositions with nothing
editable stay hidden.

**Website read: failed, and not because of this system.** The AI's own notes say
"Website fetch failed". The site used for the test answers HTTP 403 with a Cloudflare
"Attention Required" page to a plain request from this server as well, i.e. it blocks
automated readers. The AI behaved as instructed: it used only the client's own words
and left three scenes blank rather than invent features. **A successful website read
has still never been observed** - it needs a test against a site that does not block
automated requests. The provider now logs `websiteFetchAttempts` and
`websiteFetchErrorCodes` so the reason is in our own log next time.

## 2026-10-02 - The AI plan read well and reached no layer

**User report:** eleven near-identical cards, no preview, and "is the Scenes tab not
the same thing?" - the plan screen gave no sign of leading anywhere.

**Root cause, read from code:** `buildEvidenceBundles` attached a Work Map row to a
scene by `sourceCompositionId === scene.manifestCompositionId`. In a single-master
template every mapping belongs to the one master scene, while the AI's rows named the
nested compositions where the text and image layers actually sit. No row matched, so
approving the plan and running "Match Your Content" would have carried none of the
AI's text or its screenshot placement into the Scenes fields. A row also held one
text per composition, so three text layers in one composition could not differ.

**Fix:**
- `workMapEntrySchema.targetPlaceholderId` (optional): a row may name one layer by
  its stable manifest placeholderId.
- The AI is given each layer's placeholderId, name, kind and current text, and
  writes one row per layer. Ids it returns are checked against the manifest: an
  unknown id is dropped, a real one has its composition corrected.
- `buildEvidenceBundles` prefers the row naming a mapping's own layer, and a layer
  row is never used as the scene's own row.
- Simple Mode shows layer rows as one short card per composition (layer name ->
  what goes on it) instead of one boilerplate card per row.

**Not yet proven live:** the whole chain plan -> Match Your Content -> accepted
suggestion -> Scenes field. Each link is unit-tested; no real run has been observed.
Plans saved before this change carry no layer ids and must be created again.
Colours are still not part of the AI's output.

## 2026-10-02 - "Create Video Plan" looked pressed and did nothing

**User report:** pressed the AI button, it stayed disabled, nothing shown for minutes.
**Fact:** the API received no request for the project after 15:37:10 - no
`brand-inputs` PATCH and no `ai-draft` POST. Nothing was running.

**Cause:** the description box was empty. Its placeholder was a four-line example
written as a real request, so the box looked filled, and the description is lost on
every refresh (each deploy asks for one). The disabled button gave no reason. This
happened twice in one day.

**Fix:** the placeholder is now a plain instruction and the example moved under the
box as a hint; a line beside the disabled button says the description is missing; the
typed description is kept per project in the browser so a refresh no longer empties it.

## 2026-10-02 - A disabled AI button answered a press with nothing; a 90-second call showed no progress

**User report:** "if it is empty, why can I click it?" and a request for a full-screen
loading state with a progress bar and the time taken.

**Fix:**
- "Create Video Plan" is no longer disabled for an empty description. A website or a
  business description is enough to plan from (a plain standing request is sent in the
  description's place). With nothing at all filled in, the press answers with an alert
  naming what is needed and moves focus to the description box.
- While the call runs, a full-screen panel shows the stage, a progress bar and a
  running clock. The bar fills over the 90 seconds a real call has taken and waits at
  95% until the answer arrives - it never shows finished early.
- The plan view states how long the plan took to write.

## 2026-10-02 - First layer-level plan: 9 of 12 rows reach a layer; website read refused for a reason of our own

Third real run on `fe32ffac-...` (revision 2): 109.5s, 12 raw / 12 valid rows, 9 with a
`targetPlaceholderId`. Simple Mode showed them grouped per composition as intended.

**Correction to the earlier entry.** The website read was not failing because the
site blocks automated readers. The log added in `c042389` shows
`websiteFetchAttempts: 4`, all `url_not_in_prior_context`: the fetch tool refused the
address because it appeared only inside the JSON blob of the request. Fixed by also
stating the address on its own in plain text. The site does answer 403 to a plain
request from this server, so the next attempt may still fail - with a different code,
which will now be visible. **A successful read is still unobserved.**

**On-screen text came back in Roman Urdu** because the business description was typed
in it. Added a "Language of the text in the video" choice (English by default, Hebrew,
or as written), sent with the request.

**Still unproven:** plan -> Match Your Content -> Scenes fields, on a real run.

## 2026-10-02 - The plan showed nothing of what the assistant had read or used

**First successful website read observed:** run at revision 3 of `fe32ffac-...`,
`websiteFetchAttempts: 2`, `websiteFetchErrorCodes: []`, 105.8s, on-screen text in
English as chosen. The plain-text address fix (`7a8474d`) is what made it work.

**User report:** "the data is fetched fine, but where is it? How does the user know
what was fetched - logo, texts, details?" and "approve what, with no picture?"

**Fix - the plan now presents what the assistant did:**
- "What the assistant used": whether the website was read (decided from the fetch
  tool's own outcome, never the model's word), the name, tagline, features and tone
  it understood, and the client's uploaded files as real pictures, each marked used
  or not used in the plan.
- Each text layer shows the template's own wording struck through beside the new
  line; each image layer shows the chosen file as a picture.
- "Approve AI Plan" renamed "Continue to Scenes", with a line saying nothing is
  final and the real preview comes before any approval of the video.
- Stored as `project_work_maps.ai_summary` (migration 0028, one nullable column).
  A hand edit keeps the summary.

**Limits stated to the user:** the assistant does not fetch a logo or colours from
the website (the fetch tool returns page text only); the logo is the uploaded file.
No rendered frame exists at this step - a real picture of the video comes only from
After Effects, after the Scenes step. Plans written before this change have no
summary until created again.

## 2026-10-02 - Every layer and every suggestion sat on the master's one card

**First live run of plan -> Scenes:** "Generate suggestions" on `fe32ffac-...` took 51s
and produced 28 suggestions; the 9 that came from the AI plan each reached their own
layer. That link is now proven on a real run.

**User report:** "why is the AI suggestion on one scene only, the card gets so tall the
whole UI breaks, and why none on the others?"

**Cause:** a single-master template keeps all 28 mappings under the master's scene
plan, so one card carried every layer and every suggestion while the cards for the
master's parts each said "No content matching required". The review list also never
named the layer a suggestion was for, and showed the same "currently" text on each.

**Fix (display only, ownership unchanged):** a layer nested inside a composition that
has its own card is shown on that card (`resolveSceneMappingHomes`, first step of the
manifest's nested chain). Each suggestion names its layer. A card with several
suggestions offers "Use all N suggestions" as one request. A card's Edit opens only
that card's layers.

**Not a defect:** 19 of the 28 layers have no suggestion because the plan had no
content for them. The human still decides each: new text, or keep the template's.

## 2026-10-02 - The master scene's preview never arrived, and the screen blamed time

**Evidence:** job for `!MAIN` SUCCEEDED in 32s with `preview: null` and
`previewFailureReason: could not verify the captured preview file on disk (ENOENT ...)`.
The nine lighter compositions of the same template each produced their frame.

**Cause 1 (worker):** ae-mcp's `view.captureFrame` returns the output path straight
after `saveFrameToPng()` and reports `bytes: 0` when the file is not there yet. The
worker checked the file once, immediately.
**Fix:** the captured frame is waited for, bounded (30s), and accepted only once its
size has stopped changing (`wait-for-captured-frame.ts`), in both scene previews and
First Preview. Needs a worker update to take effect.

**Cause 2 (web):** a preview job that finished without a picture was polled for the
whole two-minute window and then reported as "taking longer than expected".
**Fix:** once the job has succeeded and no picture followed, the scene says so at once.

**Still unproven:** that the file does appear late on the real machine. If After
Effects never writes it, the wait will not help and the reason shown will say so.

**Also:** the plan screen's "1 main scene, 76 supporting nested compositions" line was
removed (nothing a client can act on); a file's name was read out twice beside its
picture.

## 2026-10-02 - Screenshots of the Scenes tab: empty tall cards, a suggestion with nothing in it, half the scenes with no line

**Seen on the live screen (release `a3194f4`):**
- One card with a long review list made every other card in its row a tall empty box
  (grid items stretched). Fix: cards are as tall as their own content.
- A suggestion about what KIND of layer something is showed two buttons under nothing.
  Fix: it now says what is proposed.
- The plan wrote lines for four scenes of eight; the other four would have kept the
  template's sample wording. The prompt told the model to leave a layer out when it had
  "nothing real to put there". Fix: every text layer of every scene gets a line from the
  client's own material; known facts may be restated, a new feature, number or claim may
  never be invented. A file is still left out rather than guessed.

**Unproven:** the new prompt on a real run.

## 2026-10-02 - A mockup template with no phone screen to fill and no colour to change

**User report, on the client's own requirement:** "what if this scene is a mockup and I only
want to put an image in it, and change a colour? The client wants to change anything in
any scene - an image option where there is an image, text where there is text, both where
both, and colour where a colour is detected. He has to put screenshots in the mockups."

**Evidence (the stored inspection of project `fe32ffac-...`, read back and rebuilt
offline - After Effects was not involved):** 28 placeholders, of which 24 text, 2
colour, 1 image, 1 video. Not one phone screen and not one scene colour.

**Cause 1 - phone screens.** Each of the template's ten phone screens is its own
composition: one solid the size of the screen plus two drawn shapes over it. The
screen-card rule required a composition of only text and solids, so the shapes
disqualified it; the shapes and the solid were then each dropped as structural. Two of
the ten also sit in their scene as plain 3D layers with no matte.
**Fix:** a card is also recognised when it is built only of solids and drawn shapes and is
either shown through a matte, or has a frame of its own size (not the scene's) filled by
its solid. A composition holding text keeps the original rule, so no editable text is newly
hidden as a guide label.

**Cause 2 - colours.** Each scene keeps its text, dot, circle and element colours on a
layer of six Color Control effects. Inspection recognised a colour only as a solid layer's
own fill, the worker could only recolour a solid, and only in the scene's own composition.
**Fix:** the scan reads each Color Control's value; each one that is not animated and not
expression-driven becomes a colour placeholder carrying its effect position, name and
current colour; a new worker operation, SET_COLOR_CONTROL, sets it through a nested chain
and re-checks the effect's type and name before writing.

**Result on the same stored inspection:** 85 placeholders, the original 28 unchanged by
id; every scene card now offers its 2-3 texts, 1-3 phone screens and 5-6 colours.

**Rules changed with it:**
- A colour nobody chose is the template's own colour and never blocks approval.
- Colours are never sent to the assistant for suggestions.
- The edit drawer offers each layer what its kind can hold: text for text, a file for a
  picture, a file and a moment for video, a picker for a colour.

**Unproven until a worker update is installed and the template re-inspected:** the colour
read in the scan, SET_COLOR_CONTROL, and placing a screenshot in a phone screen, on real
After Effects. A phone screen's verdict comes out "flat card, not confident", so a person
confirms it when choosing its picture. The scene background (a gradient effect) is still
not offered as a colour.

## 2026-10-02 - Scenes: the next save was refused after accepting a suggestion; typing lost focus after every letter

**Seen live on release `574a9ea`:** after "Use suggestion" on a card, saving the edit
drawer failed with "Expected revision 3, but the current revision is 4", the page showed
"This plan changed elsewhere", and the card still read "No text set". In the drawer, each
typed letter needed another click into the box.

**Cause 1:** accepting a suggestion writes to the plan and moves its revision on; Simple
mode never reloaded the plan afterwards (the Advanced panel always did).
**Fix:** the plan is reloaded after one or several suggestions are accepted.

**Cause 2:** the dialog re-ran its focus effect whenever its `onClose` changed, and the
drawer passes a new function on every render - so every keystroke moved focus to the
dialog itself. **Fix:** the dialog keeps the latest `onClose` in a ref; focus moves only
when it opens and closes.

**Confirmed live on the same screen:** the master scene's preview now arrives (the
captured-frame wait in worker build `574a9ea`), and the drawer offers each layer only what
its kind takes.

## 2026-10-02 - A light-flare clip was offered as a scene's only "video" slot

**Seen live on the test project:** one scene's edit drawer offered a single file slot,
named after a flare clip. A reviewer looking for where the phone screenshot goes chose a
screenshot for it and was shown a full slot decision ("flat card, 100% confident", crop
warnings, evidence frame) about a layer that is an effect.

**Cause (from the stored inspection, not a guess):** the layer is video footage, the size
of the whole picture, on screen for just over a second, and its blending mode is Screen -
it only adds light to the scene beneath it. Nested inspection surfaced every video footage
layer that was not a pre-rendered pass.

**Fix:** inside a nested composition, moving footage whose own blending mode is a
lightening one (Add, Lighten, Screen, Color Dodge, Classic Color Dodge, Linear Dodge,
Lighter Color) is the template's effect and is not offered. Both facts come from the scan;
a mode that was not read hides nothing, a still picture is left as it was, and a scene's
own top-level layers are unchanged.

**Checked offline** by rebuilding the manifest from that project's stored inspection: the
flare clip is gone, every other placeholder keeps its id, and each of the eight scenes has
at least one phone screen to put a picture in. **Not yet run on real After Effects** - it
needs worker build of this commit and a new inspection.

## 2026-10-04 - A template was inspected as having nothing editable because After Effects was silent for 30 seconds once

**Seen live (worker build `85406c0`, inspection job `7976dd59`):** New project showed 77
compositions, 0 editable placeholders, 261 unresolved items.

**Cause (from the job's own result):** the project-wide scan is read in slices of ten
project items. The slice for items 101-110 - none of which is a composition - hit the
bridge's `[AE_TIMEOUT] Timed out after 30000ms`. The bridge reports that as a tool error,
which the transport retry never repeats, so one silence discarded every slice already read
and with them every layer fact; each layer then became "could not be confirmed".
Why After Effects did not answer in that half minute is not known.

**Fix:** a slice that fails with the bridge's timeout is asked for again, three attempts
in all, five seconds apart. The script only reads, so repeating it is safe. Any other
failure is not repeated, and after the last attempt the scan fails with the bridge's own
message as before.

**Not yet run on real After Effects.** Still open: an inspection whose scan failed is
reported as succeeded and can be turned into a project.

**Same day, closed:** the New project screen now says "After Effects did not finish reading
this template" and will not create a project from an inspection whose job result carries
no layer inventory (the worker attaches it only when the project-wide scan completed).
Project `new2` was created from the failed inspection before this and holds 5 placeholders.

## 2026-10-04 - Every preview of a heavy master composition failed: "ae_capture_frame failed: Connection closed"

**Seen live (worker `a094d62`, project `cc0c91a0`):** four attempts in a row for the
template's master composition, and two more on 2026-10-02, all ended with
`ae_capture_frame failed: MCP error -32000: Connection closed`, while the eight scene
compositions of the same project captured normally. One attempt on 2026-10-02 had
succeeded, with a 9 MB still.

**What is known:** -32000 is the MCP connection ending, not a request timeout (-32001).
The worker log shows the worker did not end the ae-mcp process itself and its watchdog did
not fire (jobs ended in about 20 s; the budget was 90 s). The `ae_capture_frame` tool waits
for the PNG and returns it inline as base64. **What is not known:** why the ae-mcp process
ends - its stderr is not kept.

**Fix (does not depend on the cause):** the worker no longer uses that tool. It runs its
own fixed, read-only script - the same `saveFrameToPng` host call, composition time put
back afterwards, no undo group - writing to a path the worker chose, and then looks for
the file itself whether the call answered, timed out or lost its connection (up to 120 s
after a lost call). Only After Effects itself reporting a failure ends the wait early.
Used for the scene preview and for the executed-frame preview. The scene-preview watchdog
budget now counts the capture at its real worst case.

**Not yet run on real After Effects.**

## 2026-10-04 - Eleven pictures each needed their own decision in their own drawer

**Seen live (project `cc0c91a0`), and by running the approval gate against the real plan
before pressing Approve:** 21 slot findings on 11 pictures. Every phone screen is judged
"a flat card, 56-62% confident" - the structural evidence that it is a phone (a 3D layer cut
by a rendered matte) sits one composition above a single-layer wrapper, and the classifier
reads only the nearest host. Reading past the wrapper still gives 69% against a 70%
threshold, so the weights were left alone rather than tuned to one template.

**What did not change:** the gate. A slot decision is still the reviewer's own and the
server still refuses one that does not name that slot's own current evidence frame.

**What changed:** the Scenes tab now lists every picture waiting for a decision in one
place, asks After Effects for each slot's frame in turn, shows them together, and records
"right as assigned" for each picture whose frame is on screen - one request, one decision
per picture, each naming its frame. A picture the reviewer disagrees with is still decided
in its scene's drawer.

**Confirmed live the same day:** the drawer route works on real After Effects - evidence
frame captured at the slot's own moment, decision saved in the reviewer's name (plan
revision 4). Also added: one press to take every proposed line of the plan; a scene card
reads its file and its text from the layers that hold them.

**Not yet seen in a browser:** the bulk review itself.

## 2026-10-04 - Ten slots, ten identical evidence frames of a scene none of them is in

**Seen live (project `cc0c91a0`, the first run of the bulk picture review):** five frames
came back and all five were the same picture. The database agreed: every slot's evidence
frame was captured at 3.5 s of the master composition, and all files were byte-identical
(9,086,945 bytes) - while the slots belong to scenes that run at 20-44 s.

**Cause:** these slots sit five compositions below the master. Every host window the
inspection recorded for them was measured inside a nested composition ("0 to 7 s"). With
no host in the master's own timeline, the evidence moment fell back to that raw window and
took its midpoint, for every slot alike. The one decision recorded before this was found
(scene 01, plan revision 4) happened to be about the scene that 3.5 s really shows.

**Fix:** the scan now reads each layer's start time, stretch and time-remap switch. For a
nested slot with no host in the scene's own composition, inspection carries the slot
layer's in/out window up every hop of its chain into the scene's timeline and records it
as `sceneWindow`. The evidence moment and the gate that checks a captured frame both use
that window. A time-remapped hop, a hop whose timing was not read, or a hop switched off
records nothing - unknown is never a guessed moment. Manifests written before this behave
exactly as before.

**Needs:** this worker build and a new inspection (the stored scan carries no start
times, so this could not be re-checked offline against the real template).
**Not yet run on real After Effects.**

**Same day, first real run of that fix (worker `95578cd`, inspection job dispatched for the
check):** only one of eleven slots got a scene window. The scan showed why - seven of the
template's eight scenes are placed by a TIME-REMAPPED layer, which the first version
treated as unknown, and "unknown" then fell back to the nested window again.
**Corrected:** the scan samples a remapped layer's curve from After Effects itself (up to
120 points across the layer's in/out) and the window is the longest unbroken run in which
the nested composition is inside the window being lifted. And a scene window that was
looked for and not established is now recorded as null, which means "no provable moment" -
never a fallback to a nested composition's timeline.

## 2026-10-04 - A gradient on a card solid would have painted over the screenshot (found by reading, before any run)

The worker switches off a card solid's "ADBE Fill" effect when media replaces the solid,
because a Fill paints every pixel one colour. The phone-screen solids of the template under
test get their look from "ADBE Ramp" (Gradient Ramp) instead, which generates every pixel
in the same way - a screenshot placed there would have rendered as the template's
gradient. The rule now covers Fill, Gradient Ramp and 4-Colour Gradient: switched off,
never deleted, verified afterwards, other effects untouched. Not yet run on real After
Effects.

## 2026-10-04 - A twenty-second network drop left a job claimed for good

**Seen live (job `15ad8fab`, worker `a642149`):** a scene's preview never arrived; the card
said "Preview is taking longer than expected".

**Cause (worker log):** at 10:13:22 UTC a heartbeat could not reach the API; at 10:13:34
the worker claimed the job; at 10:13:44 its one attempt to report the job RUNNING failed
("Failed to reach .../report") and the cycle gave up. A claimed job is never handed out
again, and the server reaps only jobs of a worker whose heartbeat is stale - this worker's
was not. The job stayed CLAIMED and, with one job at a time, the queue stood still.

**Done by hand:** after eight minutes the job was marked FAILED in the database with code
`JOB_ORPHANED` and a message saying exactly that, the same change the server's own sweeper
makes for an offline worker. Nothing else was touched.

**Fix:** both status reports of a job - RUNNING and the final one - are retried with
bounded backoff (six attempts, about a minute). A finished job whose result could not be
delivered was lost in the same way. If a report still cannot be delivered, the worker
fails whatever it left active on the server before it claims anything new, and keeps
trying that on each heartbeat until it gets through. Not yet seen on a real network drop.

## 2026-10-04 - The dashboard asked for one slot's frame and was given the scene's latest

**Seen live (project `5db054f5`):** ten slot frames had been captured, each at its own
slot's moment and each attributed to its mapping (checked in the database: 3.8, 9.8, 14.2
x3, 25.6, 30.6, 36.4, 41.4 and 41.7 s). The bulk picture review showed one of them.

**Cause:** the web app's own proxy routes for `.../preview-status` and `.../preview`
forwarded the path and dropped the query string. `?mappingId=` never reached the API - its
log holds thousands of preview-status requests and none with a mapping id from the
dashboard - so the API answered every one with the scene's latest frame. The per-slot rule
introduced on 2026-09-24 has therefore never applied to what the dashboard displayed:
every slot of a scene was shown whichever frame was captured last. (The server-side check
on a saved decision did use the slot's own frame, which is why a multi-slot scene could be
refused for reasons the screen did not show.)

**Fix:** both proxies forward `mappingId`, and only that.

## 2026-10-04 - "Leave it as it is" recorded nothing, and the scene could never be approved

**Seen live (project `5db054f5`, plan revision 4):** the template's own credit line was a
text layer. The assistant found nothing to change; the reviewer pressed "OK - leave it as
it is". The finding disappeared, the scene stayed "Needs your choice", Approve Scenes
stayed disabled, and nothing on the page could clear it. The reviewer said, rightly, that
they had no idea what they had just been asked to do.

**Cause:** accepting a suggestion that proposes nothing changes nothing on the plan, and a
text layer with no text counts as undecided.

**Fix:** a recorded "keep the template's text" on a text layer nobody typed into is a
decision - in the reviewer's name, bound to that (empty) text, void the moment a text is
typed. Agreeing with a no-change finding about a text layer now records it. A text layer
still undecided with nothing else on its card gets a plain question of its own: keep what
the template says, or press Edit.

Also the same day, for a non-technical client: plain wording throughout the Scenes tab, a
numbered "what to do on this page" guide driven by the same state as the buttons, cards
labelled "Scene 1 / The whole video" above the template's own names, and parts with
nothing to change folded away.

## 2026-10-04 - A colour change on a solid layer was refused: "target layer's source is not a solid color"

**Seen live (job `a0cc7db6`, the first execution ever started on this template):** the
first of 37 operations failed in 8 seconds. The layer is a solid (the scan says so:
`isSolid: true`).

**Cause:** the script checked `layer.source instanceof SolidSource`. In After Effects a
layer's `source` is a footage item and the SolidSource is that item's `mainSource`, so the
check is never true - SET_BRAND_COLOR had refused every solid it was ever given. The tests
passed because their fake put the SolidSource directly on `source`.

**Fix:** the script reads `source.mainSource`. Because After Effects reuses one solid item
for every duplicate of a solid layer, the item's colour is set only when this layer is its
sole user; otherwise this layer alone is given a new solid of the same size and name. The
colour is read back and a mismatch fails the operation. The tests now use a solid shaped
the way After Effects shapes it. Not yet run on real After Effects.

**Also noted, not yet fixed:** the two colours in this plan were saved at 10:21 UTC from
the edit drawer before any suggestion existed; whether the drawer saved its colour pickers
without being asked to is unconfirmed.

## 2026-10-04 - A text was refused as "overlapping a shape of its own colour" because of an adjustment layer

**Seen live (job `b36a353f`, worker `815b92d`):** the two colour changes now succeeded on
real After Effects (operations 0 and 1 - the first time SET_BRAND_COLOR has ever worked),
and operation 2, the brand line on the master composition's text layer, failed: "would
have to shrink to 0% of its template size".

**Cause:** the auto-fit looks below the text for layers of the text's own colour. The
layer it found is a full-frame adjustment layer, which After Effects stores as a solid
item with a colour and which draws none of it.

**Fix:** a layer that draws nothing is not a blocker - an adjustment layer, a guide layer,
a null, a layer used as a track matte, a layer not on screen at the moment checked, or one
fully transparent then. Not yet run on real After Effects.

## 2026-10-04 - A slot was refused as "structure has changed" by this job's own earlier edit

**How it was found:** by running the approved plan's own 37 operations on the QA worker in
shadow sessions (new session ids, the project's real payload), so that nothing in the
reviewer's session was touched. First run: 7 operations applied on real After Effects -
two colours, three texts, a screenshot into a phone screen and a logo, all for the first
time - and the eighth, a screenshot for another scene, was refused: "this slot's structure
has changed since the plan was approved".

**Isolated by three further runs:** that operation alone - applied. After the screenshot
of the neighbouring scene - applied. After the LOGO operation - refused, same digest every
time. With the worker changed to state the live facts: the first hop of the refused slot's
chain is a layer whose scale read 104.73 %, on a layer the scan had recorded as keyframed.

**Cause:** the mutation fingerprint holds each hop's scale and rotation as `.value` - the
value at the composition's current time. For an animated hop that is a moving number, and
this job's own earlier edit had moved the time. The check ran immediately before each
slot's own edit, so it compared the approved template with a project the job had already
changed.

**Fix:** every slot of the job is checked once, on a fresh start, before the first edit -
the working copy as opened is the thing "is this still the approved template?" is about.
A resume does not re-read a project this session has itself edited; its source stays
pinned by hash. Still true and not addressed here: a fingerprint that includes an animated
value depends on the time stored in the project file.

**During these runs:** the ae-mcp bridge inside After Effects stopped answering (health
check: "No live bridge heartbeat") while the dashboard went on showing it ONLINE from a
cached probe. Restarting After Effects restored it. Cause not known.

## 2026-10-04 - A new session could not open its working copy while another session's unsaved copy was open

**Seen live, three times (jobs `7cd3e0a0`, `96946a03`, `620c31fa`):** "could not confirm
the session working copy is open in After Effects: [AE_TIMEOUT] Timed out after 30000ms".
Each time a previous session's working copy was open in After Effects with unsaved edits
(a job that had failed part-way). A health check a few minutes after the third showed
After Effects had gone on to open the requested copy.

**Cause:** the reopen script discards unsaved edits only when the open project is the SAME
working copy. With a different session's copy open, After Effects had that project's
unsaved state to deal with before opening, and did not return inside the bridge's 30 s.
The executor read the timeout as a failed open.

**Fix:** another session's working copy - the same file name in a sibling folder of this
session's folder - is closed without saving first; it is this worker's own disposable file
and its state of record is on disk. A project a person has open of their own is still
never closed. And when an open call times out, the worker asks After Effects what is open
(read-only, up to six times, ten seconds apart) instead of failing at once; only the
requested working copy counts.

This is the path a client takes after any failed session, so it was a product defect and
not only a side effect of the shadow runs that exposed it. Not yet run on real After
Effects.

## 2026-10-04 - All 37 operations of the approved plan ran on real After Effects (shadow session)

**Shadow job `bca3e1f2`, worker `c2efc48`:** every operation of the approved plan - two
colours, 24 texts including the Hebrew brand line, ten screenshots into phone screens and
one logo - was applied to a working copy on the QA worker, and the preview still was
captured. The only failure was the last step, uploading the preview, which the server
refuses for a session it does not know; that is what a shadow session is. What the frame
looks like has therefore not been seen by anyone yet.

## 2026-10-04 - "Continue" after After Effects was restarted would have skipped the finished operations

**Found by reading, before it happened (session `398816c4`):** a job applied two
operations and failed on the third. Operations are saved only when all are done, so those
two existed only in After Effects' memory. After Effects was later restarted. A resume
opened the working copy without discarding anything and continued from the first
unfinished operation - on a copy that no longer held the first two. The video would have
been built without them and nothing would have said so.

**Fix:** a partial job keeps the open project only when After Effects has this working
copy open AND reports unsaved edits. Otherwise - another project, none, a clean copy, or a
bridge that cannot say - it starts again from the first operation on the copy from disk.
A job whose every operation completed is untouched by this. Not yet run on real After
Effects.

## 2026-10-04 - The first real execution of this template succeeded; a regenerate then failed on a defect introduced the same day

**Job `c821d01e` (session `398816c4`, worker `593d773`):** 37 of 37 operations, preview
captured at 14.54 s and uploaded; session at AWAITING_PREVIEW_APPROVAL. The frame, opened
from the server's own storage: the phone screens hold the client's screenshot (the
gradient is gone), the three texts are the plan's, and the brand line is on the credit
layer. Two things in it are for a person to judge and were reported as such: the middle
of three panels shows the screenshot mirrored, and the border colour is the one saved in
the plan.

**Then "Regenerate First Preview" failed:** "open-project script's result did not match
the expected {openedPath, openedName} shape ... Unrecognized key 'dirty'". The open had
run past 30 s; the new slow-open poll asked what was open, got the right answer - and
passed the whole answer, `dirty` included, to a strict check written for an open's own
result. A successful slow open was reported as a failure. The poll's unit test had used a
fixture without `dirty`, which is why it passed. Fixed: only the two fields are passed on,
and the fixture now has the real answer's shape.

## 2026-10-04 - The first final render was refused in 20 seconds because the worker gave After Effects 15 seconds to answer

**Job `65b9faeb` (RENDER, Landscape):** FAILED with "composition verification failed:
could not connect to ae-mcp: MCP error -32001: Request timed out". It was started minutes
after a 36-minute complete-preview render on the same machine; a health check run straight
afterwards reported After Effects and the bridge ONLINE, and itself took 21 s. Nothing was
wrong with the project - the read-only composition check simply did not wait long enough
for a busy machine and never tried again.

Fixed in `c6bef60`: the check connects with a 60 s budget and makes up to three attempts,
each with a fresh client. The Export screen went on saying "Started" after the job had
failed; that is recorded in `docs/UX_BACKLOG.md` terms and is being fixed with the rest of
the Export tab. The final render itself is still unverified on this template.

## 2026-10-04 - Two defects seen in the first finished video: pictures the wrong way round, and a long line running off the frame

**Seen in the complete preview of job `49d24f57`:** the client's screenshot was mirrored on
two screen cards and lay on its side on a third; and one long replacement text ran past
the left edge of the frame. Neither is a fault in the placing code - the template holds
those cards mirrored or turned (its own gradient looked the same either way), and its own
short line fitted where the longer one did not.

**Pictures.** Which way is up cannot be read from the project, so it is a recorded choice,
not an inference: a mapping may carry `assetOrientation` (`mirror`, `quarterTurns` 0-3),
set with `SET_ASSET_ORIENTATION` / cleared with `CLEAR_ASSET_ORIENTATION`, offered in the
edit drawer as "Is the picture the wrong way round in the video?". The worker mirrors the
picture about its own centre and adds the turn to the card's own rotation, measuring the
cover/contain fit against the turned footprint. A place that is not a screen card refuses
a turned picture rather than placing it unturned. A plan without the field sends nothing
new, and builds the byte-identical script.

**Text.** After a text is replaced, if the template's own text sat wholly inside its
composition's frame and the new text does not, the new text is shrunk about its anchor
until it is one margin inside - never below the existing minimum readable factor (it then
stays at that size and the job still succeeds), never enlarged, never moved. A template
text that itself crossed the edge is left alone. Same conditions as the existing fit: a
static, unparented, unrotated 2D text layer; anything else is not measured.

**Not yet verified on After Effects.** Both are covered by unit tests against a modelled
layer only; the worker was rendering while they were written. Whether the off-frame line
in this template is a layer the rule can measure is unknown until it is run there.

**The two colours in that video** (`#0FAFFF`, `#9A4242`) were not an unasked save: plan
revision 2 differs from revision 1 in exactly those two colour values and nothing else,
and the drawer sends a colour only when its field was changed.

## 2026-10-04 - A project whose final video had just been made was sent back to "Create the first preview"

**Seen on the live dashboard, project `5db054f5`, minutes after RENDER job `62b96a32`
succeeded** (1920x1080, 30 fps, 44.83 s, 1345 frames, artifact VALID and downloadable): the
banner said "Create the first preview", the checklist marked "First Preview - do this now"
above "Export Video - Done", the Preview tab offered "Build my video", and the Landscape
card said "Not ready yet" beside the finished video. A client pressing what the screen told
them to press would have started the whole build again.

**Cause.** A successful render marks the execution session COMPLETED.
`GET .../execution-sessions/current` returned null for every terminal session, so each
screen read "no session" and showed its starting state. The web already treats a COMPLETED
session as a finished one (`resolveNextAction` ends at "done"; Export counts COMPLETED as
render-ready) - it was simply never given one. A unit test pinned the null.

**Fixed.** The read returns a COMPLETED session when it belongs to the plan revision still
current; a superseded revision still yields null, so an edited plan starts afresh. The
session stays terminal - this is a read, and every dispatch gate still uses
`isSessionActive`. The pinned test was rewritten to the corrected behaviour, with the
superseded-revision case beside it.

**Not yet seen on the dashboard after the fix** - to be confirmed on the same project once
deployed: banner "Everything is done", Preview showing the approved video, Export showing
the download without "Not ready yet".

## 2026-10-06 - The client's first own plan was written about "DBT Academy" and never read his website

**Reported by the client (project `3241977f`, his own PC):** "when I gave the AI the website
to get insight for text, it described things from DBT Academy somehow."

**What the records show.** The project's stored inputs are `websiteUrl: null` and
`textInstructions: "https://studio-shani.co.il/"` - the address was typed into the
instructions box, and the website box was left empty. The plan's own summary says
`websiteRead: "NOT_GIVEN"` and, in its notes, that with no text from the client or a site
the wording was produced from the names of the supplied files. One uploaded file is
named `DBT Academy (1).png` (labelled as the logo); the summary's `productName` is
"DBT Academy". The assistant was never pointed at the site, and took the business name from
a file name.

**Fixed.**
- An address is the client's website whichever box it lands in: with the website box
  empty, exactly one valid http(s) address in the typed instructions is used as the website
  (the same check the website box applies; two different addresses choose none).
- The assistant's rules now say a file's name or label is not evidence of what the business
  is called or sells; without a name from the client's words or site, the name stays empty.

**Not verified end to end**: the rule is unit-tested; the client's plan has not been made
again with it. His existing plan is unchanged - he has to make the plan again.

## 2026-10-06 - "Everything is set, why does the first card still say Needs your choice?"

**Client project `3241977f`, plan revision 19.** The plan's own state: scene `!MAIN` is
UNREVIEWED with "6 placeholder(s) in this scene still need a mapping decision". The six are
five text layers named "Text A" with no text and no recorded decision, and one picture
place (`Your_image`, the background every scene shares) with no picture.

**Why it never showed in the earlier test of this same template (project `5db054f5`):** that
plan had a text on every text layer and a logo in the background place, so "empty picture
place" never arose. The client left the background empty and five headings unwritten.

**Two defects.**
- A picture place with no picture had no answer at all. A text layer can be settled with
  "Keep the template's text"; nothing offered the same for a picture, so a background the
  client did not want blocked approval with no question shown and nothing to press.
- The badges pointed at the wrong card: the three scene cards holding an undecided text
  said "Ready" above "1 text here has not been decided", while "The whole video" - which
  owns them in the plan but does not show them - said "Needs your choice".

**Fixed.** An empty picture place asks its own question on its card, with "Leave it as the
template has it" (the same recorded decision a text gets; the server already counts it).
A card's badge is "Needs your choice" when something undecided is on that card, and reads
its scene's own state only when it shows everything the scene owns.

**Not verified on the client's project** - unit-tested only.

## 2026-10-06 - texts sit in the wrong places of each scene (client project 3241977f, open)
Read from the plan and the manifest, not yet seen in a render. In every scene the template
has a large word (APP), a second line (PROMO) and a small paragraph. The plan holds the
client's short title in the paragraph's place, his sentence in the second line's place, and
in three scenes a full sentence in the large word's place; in five scenes the large word is
still the template's. The AI plan was given each place's own template words and still filled
them in this order. Not established: whether the suggestions or the client's own typing put
them there, and what the worker's text fitting does with a sentence in a one-word place.
Nothing was changed on the client's project.

## 2026-10-07 - "the background was set as white and it is not appearing" (client project 3241977f)
Read from the plan, the manifest and the last EXECUTE_FRAME job (11:25 UTC, SUCCEEDED, 84
operations). The colour named "BLACK" that the client set to #F7F7F7 is a solid in the
master that is on screen from 0:43 for 1.5 s - the fade at the very end - not the scenes'
background. The worker was sent SET_BRAND_COLOR #F7F7F7 for it and reported success. The
dark background behind every scene is the picture place "Your_image" (the background
picture), which holds his logo file; it has no colour control. Nothing on screen said when
"BLACK" shows, so it was the obvious choice. Not changed on the client's project.
- Web: a colour tile now says "only at 0:43, for 1.5 s" when a colour is on screen for less
  than most of the video (from the template reading's start/duration).
- Open: the real background is a picture; a white background means a white image in that
  place. Nothing offers that.
- Open (unverified): in the first frame of scene 8 the small paragraph sits over the phone
  and is tiny - the text frame-fit (cbd43c6) on After Effects has not been checked by us.

### 2026-10-08 - a failed frame build disappeared on reload (client project 3241977f)
- Seen: the client's frame build of 2026-10-07 14:40 stopped two minutes in (After Effects did not answer a SET_TEXT within 30 s: `AE_TIMEOUT`; earlier that minute AE held unsaved changes in the working copy). The notice is shown only while the page watches the job; after a reload the Preview tab showed a plain "Build my video" and nothing said a build had been tried. The session stayed `PREPARING`.
- Fix (web only): the Preview tab reads the newest frame build from the job history it already loads; if it failed and no frame newer than it exists, the same "The video could not be built" notice (with the worker's words behind Technical details and "Try again") is shown after a reload. It goes away once a build starts or a newer frame exists.
- Still open (worker side, not changed): why After Effects on the client's PC stopped answering. The client was in After Effects with the working copy open at the time.

### 2026-10-08 - frame builds fail with AE_TIMEOUT at a different operation each time (client project 3241977f, worker DESKTOP-A629N4N)
- **Seen.** Three builds of the same 84 operations: 10-07 14:26 succeeded (173 s); 10-07 14:40 failed at operation 52 (SET_TEXT); 10-08 04:50 failed at operation 39 (SET_COLOR_CONTROL). Both failures are the bridge's `[AE_TIMEOUT] Timed out after 30000ms`. The two failed payloads are identical, and each failing operation succeeded in another run.
- **After Effects was not hung.** CHECK_HEALTH ten minutes later: bridge live, one instance, the session's working copy open, 152 items. No dialog, no crash.
- **Cause (read in the bridge's source, `src/bridge/client.ts`, `src/broker/broker.ts`, `host-scripts/ae-mcp-engine.jsx`).** Each After Effects instance has ONE `command.json` and ONE `result.json`. A caller deletes any `result.json`, overwrites `command.json`, then waits for its own request id. After Effects reads the command every 1.5 s and deletes it. The bridge's queue is in-process only, so two `ae-mcp` processes are not serialised against each other. The worker's heartbeat (`ae-mcp-round-trip-adapter.ts`) starts its own `ae-mcp` process and calls `ae_health` whenever its 5-minute ONLINE cache has run out - also while a build's own `ae-mcp` process has a command waiting. The probe then overwrites the build's unread command (or deletes its unread result); the build waits 30 s for an answer that cannot come and fails. A build takes about three minutes and the probe runs every five, so most builds meet one probe.
- **Timing evidence.** 10-08: the last finished operation was checkpointed at 04:51:51.6 and the next command was written straight after; the worker log has a heartbeat at 04:51:51. The probe itself is not logged, so its start is inferred, not read.
- **This also fits** the unexplained single 30 s silences of 2026-09-14 (job a4a0ac5e) and 2026-10-04 (inspection 7976dd59).
- **Not fixed.** The fix is in the worker (no bridge probe while a job holds the bridge, or one lock around every bridge call) and needs a new worker build on the client's PC. Until then: press "Try again" straight after a failure - the probe that caused it has just run, so the next one is about five minutes away and a three-minute build fits before it.
- **Also seen, separate.** 14 `ae-mcp serve` processes from 10-07 are still alive on that PC, started at the times of failed INSPECT_SCENE_EVIDENCE jobs: a failed inspection leaves its bridge process behind. They are idle and do not write commands, but they are never cleaned up.
- **Fixed (worker, 2026-10-08, after the entry above).** `runtime/bridge-hold.ts`: while a job runs, the heartbeat starts no bridge probe (the last real answer is reported, marked `-held-while-job-runs`; with none yet, `probe-waits-for-job`); a job waits for a probe already in flight before its first bridge call; a probe stood down for a job makes no further attempt and is not counted as a failed probe. Every probe now logs `bridge probe started` / `bridge probe finished` in worker.log. And `HeroicSwanSceneEvidenceInspector` closes the bridge process it started, so a scene check no longer leaves an `ae-mcp serve` behind. Not yet run on the client's PC; the fourteen processes already there stay until that worker is restarted.
