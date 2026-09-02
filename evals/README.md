# Evals — Three-Template MVP Acceptance

CLAUDE.md's "MVP Acceptance" requires three different plugin-free templates
to pass end-to-end before this system can be called complete. The real
Envato templates themselves are licensed client assets and are never
committed to this repo (see `docs/CLIENT_WORKER_PREFLIGHT.md`'s approved
POC project list: `Working-2026`, `Production-v01`,
`Color-Type-Test-v01`, `Tanach-Israeli-Reels-F02-Test-v02`) - this
directory is the **structure and checklist** each real template run must
satisfy, tracked here since no template file itself can live in the repo.

## One eval case per template

Copy `template-case.template.json` to `<template-name>.json` per real
template run and fill it in as each step is genuinely completed - never
mark a step done without the real evidence named. A field stays `null`
(not `true`/`false`) until it has genuinely been checked - `null` means
"not yet evaluated", never "failed".

| Field | Step | Evidence required |
|---|---|---|
| `originalAepSha256BeforeRun` / `AfterRun` | Original `.aep` hash recorded before any run, unchanged after | real sha256 before and after - both values, recorded once each |
| `originalAepUnchangedProof` | Original `.aep` hash unchanged after the full run | `true` only once `originalAepSha256BeforeRun === originalAepSha256AfterRun` is confirmed by direct comparison - never inferred from "the run succeeded" |
| `realSceneStoryboardEvidence` | Real-scene storyboard evidence | a screenshot (file path/link) or exact description of the Simple Mode storyboard for this template, proving real AE nesting evidence produced the correct real-scene grouping (never a raw composition/placeholder list) |
| `selectedScenesOnly` | Selected scenes only appear in output | manual comparison against the approved execution plan |
| `correctAssetsAndText` | Correct assets/text applied | visual check against the Work Map |
| `timestampAccuracyWithinOneFrame` | Timestamp accuracy | within one source frame (CLAUDE.md) |
| `firstPreviewApproved` | First Preview approval | the real, persisted `firstPreviewApproved` flag on the execution session (approve-first-preview.ts) - a genuine human approval of the first designed frame, not just "a preview was captured" |
| `finalPreviewApproved` | Final Preview approval | the real, persisted `fullPreviewApproved` flag on the execution session (approve-final-preview.ts) - a SEPARATE, later human approval of the complete assembled video |
| `landscapeOutputProduced` | Landscape artifact | a real render artifact, played back |
| `reelsOutputProduced` / `reelsRepositionedNotCropped` | Reels artifact | a real render artifact, played back - reposition confirmed, not merely cropped |
| `interruptedJobRecoveryTested` / `recoveryTestEvidence` | Recovery test result | a job deliberately killed mid-EXECUTE_FRAME or mid-RENDER, then successfully resumed via re-dispatch without redoing completed work - `recoveryTestEvidence` names which job/stage was killed and how resume was confirmed |
| `overallResult` | PASS/FAIL summary | `"PASS"` only once every field above is genuinely `true`/filled; `"FAIL"` if any field was checked and failed; stays `"PENDING"` (the template default) while any field is still `null` |

## Status as of 2026-09-02

No real template has completed this full checklist yet - the client
Windows Worker (`DESKTOP-A629N4N`) has been intermittently available this
session but a Windows Worker package update has not yet succeeded end to
end (see `docs/ACCEPTANCE.md`'s own live status and the session's own
MCP-health investigation). This is a genuine, tracked gap, not a silent
omission - see `docs/ACCEPTANCE.md` for the live status of every MVP
acceptance criterion.
