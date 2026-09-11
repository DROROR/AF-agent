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

Last updated: 2026-09-11.

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

Resolution options for the Element 3D dependency itself (separate from
the acceptance blocker above): install a genuine licensed Element 3D on
the render machine, or replace the dependent design. Pending client
confirmation of whether they already own a license.

**`preflight.pluginReferences` was an empty stub until this incident** and
a real operator read `pluginReferenceCount: 0` as proof of plugin-free
status while the template was Element 3D-dependent throughout. It is now
populated from a real project-wide effect scan, and a failed scan is
surfaced as an explicit `unknownItems` warning rather than looking like
zero - see `parse-project-effects-scan.ts`.

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
