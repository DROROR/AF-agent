import type { PlaceholderType } from "@dyo/schemas";

/**
 * The Phase 6 scene/placeholder approval editor's row shape - UI/view-model
 * only, not a wire contract (no execution-plan.json API exists yet, so
 * there is nothing in @dyo/schemas to reuse for the editor-state fields
 * here). `placeholderType` DOES reuse @dyo/schemas' own PlaceholderType
 * enum rather than redeclaring the same conceptual list, since that part
 * genuinely is the shared, already-real contract (template-manifest.ts).
 *
 * Column mapping mirrors CLAUDE.md's Phase 4 approval table exactly: Use,
 * Final Order, Scene, Placeholder, Asset, Text/No Text, source timestamp,
 * Final duration, Special instructions.
 */
export interface SceneTableRow {
  sceneId: string;
  placeholderId: string;
  use: boolean;
  finalOrder: number | null;
  sceneLabel: string;
  placeholderLabel: string;
  placeholderType: PlaceholderType;
  assetName: string | null;
  hasText: boolean;
  sourceTimestampSeconds: number | null;
  finalDurationSeconds: number | null;
  notes: string;
  approvalState: "pending" | "approved" | "rejected";
}
