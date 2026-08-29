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
mark a step done without the real evidence named.

| Step | Evidence required |
|---|---|
| Original `.aep` hash recorded before any run | real sha256, recorded once |
| Original `.aep` hash unchanged after the full run | re-hash matches the recorded value exactly |
| Selected scenes only appear in output | manual comparison against the approved execution plan |
| Correct assets/text applied | visual check against the Work Map |
| Timestamp accuracy | within one source frame (CLAUDE.md) |
| Real visual preview reviewed | a real captured preview frame, not a description |
| Landscape output produced | a real render artifact, played back |
| Native 1080x1920 Reels output produced | a real render artifact, played back - reposition confirmed, not merely cropped |
| One interrupted-job recovery test | a job deliberately killed mid-EXECUTE_FRAME or mid-RENDER, then successfully resumed via re-dispatch without redoing completed work |

## Status as of 2026-08-29

No real template has completed this full checklist yet - the client
Windows Worker (`DESKTOP-A629N4N`) has been offline for the relevant
portion of this project so far. This is a genuine, tracked gap, not a
silent omission - see `docs/ACCEPTANCE.md` for the live status of every
MVP acceptance criterion.
