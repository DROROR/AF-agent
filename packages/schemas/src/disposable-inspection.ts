import { z } from "zod";

/**
 * SAFE INSPECTION EVIDENCE (Stage 3, 2026-09-19).
 *
 * Every inspection that opens an After Effects project now opens a DISPOSABLE
 * COPY of it, never the immutable source and never a session working copy.
 * This module is the evidence that operation records about itself, so an
 * operator can see - per inspection, in the job's own result - exactly which
 * file was inspected, what After Effects was holding beforehand, whether that
 * state was restored, and whether the copy was cleaned up.
 *
 * WHY A COPY AT ALL: a read-only inspection still has to open the project, and
 * anything that opens a project can mark it modified, can be saved over by an
 * accident elsewhere, and leaves After Effects sitting on a file the next
 * operation may assume is untouched. The real 2026-09-18 incident was exactly
 * that: a capability check left the session's working copy open and modified,
 * and something later wrote it to disk, invalidating an approved artifact.
 */

/** Why a safe inspection refused or failed. Each is distinct because each needs different operator action. */
export const DISPOSABLE_INSPECTION_FAILURE_CODES = [
  /** Another project job or inspection holds the project lock. */
  "BUSY",
  /** The file to inspect does not hash to what the caller expected - refuse before touching anything. */
  "TARGET_HASH_MISMATCH",
  /** The directory beside the inspected file is not safely writable, so a copy preserving relative footage cannot be made. */
  "TARGET_DIRECTORY_NOT_WRITABLE",
  /** The copy could not be made, or did not hash identically to its source. */
  "COPY_FAILED",
  /** After Effects' current state could not be read at all. */
  "AE_STATE_UNKNOWN",
  /** After Effects is holding a project with unsaved changes, an untitled project, or one whose state cannot be verified - never touched. */
  "AE_PROJECT_NOT_SAFE_TO_REPLACE",
  /** The disposable copy could not be opened, or After Effects opened something else. */
  "OPEN_FAILED",
  /** Opening the copy surfaced footage the original resolves - the inspection would have reported misleading evidence. */
  "FOOTAGE_UNRESOLVED",
  /** The inspection body itself failed. */
  "INSPECTION_FAILED",
  /** The immutable source or the session working copy changed during the inspection - a safety violation. */
  "PROTECTED_FILE_CHANGED"
] as const;
export const disposableInspectionFailureCodeSchema = z.enum(DISPOSABLE_INSPECTION_FAILURE_CODES);
export type DisposableInspectionFailureCode = (typeof DISPOSABLE_INSPECTION_FAILURE_CODES)[number];

/** What After Effects was holding before this inspection touched anything. */
export const priorAeProjectStateSchema = z
  .object({
    /** No project open at all - nothing to preserve or restore. */
    projectOpen: z.boolean(),
    /** The open project's own canonical path, or null for an untitled/never-saved project. */
    projectPath: z.string().nullable(),
    projectName: z.string().nullable(),
    /** AE's own `app.project.dirty`. Null means this build exposes no reliable dirty-state API - which fails the inspection closed whenever a project is open. */
    dirty: z.boolean().nullable(),
    itemCount: z.number().int().nonnegative().nullable()
  })
  .strict();
export type PriorAeProjectState = z.infer<typeof priorAeProjectStateSchema>;

/** Whether the project After Effects held beforehand was put back exactly as found. */
export const RESTORATION_OUTCOMES = [
  /** Nothing was open beforehand, so there was nothing to restore. */
  "NOTHING_TO_RESTORE",
  /** The same project was reopened and its identity verified. */
  "RESTORED",
  /** Restoration was attempted and did not verify - reported loudly, never assumed. */
  "RESTORE_FAILED",
  /** The inspection refused before anything was replaced, so the prior project was never disturbed. */
  "NOT_DISTURBED"
] as const;
export const restorationOutcomeSchema = z.enum(RESTORATION_OUTCOMES);
export type RestorationOutcome = (typeof RESTORATION_OUTCOMES)[number];

/** What happened to the disposable copy afterwards. */
export const CLEANUP_OUTCOMES = [
  /** The copy was closed and deleted. */
  "DELETED",
  /** No copy had been created yet when the operation ended. */
  "NOTHING_TO_CLEAN",
  /** The copy could not be deleted and was renamed aside for a human, never wildcard-deleted. */
  "QUARANTINED",
  /** Neither deleting nor quarantining worked - the exact path is reported so a human can act. */
  "CLEANUP_FAILED",
  /** After Effects could not be proven to have closed the copy, so it was deliberately left on disk rather than deleted underneath a live handle. */
  "LEFT_IN_PLACE_STILL_OPEN"
] as const;
export const cleanupOutcomeSchema = z.enum(CLEANUP_OUTCOMES);
export type CleanupOutcome = (typeof CLEANUP_OUTCOMES)[number];

/**
 * The full, auditable record of one safe inspection. Reported whether the
 * inspection succeeded or failed - a refusal is exactly when an operator most
 * needs to see what state things were left in.
 */
export const disposableInspectionEvidenceSchema = z
  .object({
    /** What this inspection was for, e.g. "INSPECT_TEMPLATE" - free text, for humans. */
    operation: z.string().min(1),
    /** The file the caller asked to inspect (an immutable source, or a session working copy) - never itself opened. */
    targetPath: z.string().min(1),
    /** Its expected hash, and the hash actually measured before copying. */
    targetExpectedSha256: z.string().min(1),
    targetActualSha256: z.string().nullable(),
    /** The disposable copy created beside it, and that copy's own verified hash. Null when no copy was created. */
    disposablePath: z.string().nullable(),
    disposableSha256: z.string().nullable(),
    /** The immutable source .aep, hashed before and after - CLAUDE.md Safety Rule 8. */
    sourceProjectPath: z.string().min(1),
    sourceSha256Before: z.string().nullable(),
    sourceSha256After: z.string().nullable(),
    /** The session working copy, when this inspection concerned one - hashed before and after the same way. */
    workingProjectPath: z.string().nullable(),
    workingSha256Before: z.string().nullable(),
    workingSha256After: z.string().nullable(),
    priorAeProjectState: priorAeProjectStateSchema.nullable(),
    restoration: restorationOutcomeSchema,
    /** Present when restoration did not verify - the exact reason. */
    restorationNote: z.string().nullable().default(null),
    cleanup: cleanupOutcomeSchema,
    /** Present when the copy was quarantined or could not be removed - the exact file a human should deal with. */
    cleanupNote: z.string().nullable().default(null),
    /** Footage the copy could not resolve. Empty on a healthy inspection; non-empty fails it closed rather than reporting misleading evidence. */
    unresolvedFootage: z.array(z.string()).default([]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime()
  })
  .strict();
export type DisposableInspectionEvidence = z.infer<typeof disposableInspectionEvidenceSchema>;
