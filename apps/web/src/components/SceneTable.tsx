import type { ReactElement } from "react";
import type { SceneTableRow } from "@dyo/schemas";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { RowApprovalBadge } from "./RowApprovalBadge";
import { Button } from "./ui/Button";

export interface SceneGroup {
  scenePlanId: string;
  rows: SceneTableRow[];
}

export interface SceneTableProps {
  rows: SceneTableRow[];
  /** Disabled (but never hidden) while a mutation is in flight, or when the plan cannot be edited right now (e.g. APPROVED). */
  disabled?: boolean;
  onToggleUse: (scenePlanId: string, use: boolean) => void;
  onMove: (scenePlanId: string, direction: "up" | "down") => void;
  onEditScene: (scenePlanId: string) => void;
}

function formatSeconds(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Instructions (human guidance) and notes (e.g. an appended rejection reason) are distinct real fields - shown together, never silently collapsed into one. */
function formatNotesAndInstructions(instructions: string | null, notes: string | null): string {
  const parts = [instructions, notes].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" — ") : "—";
}

function groupByScene(rows: SceneTableRow[]): SceneGroup[] {
  const groups: SceneGroup[] = [];
  const bySceneId = new Map<string, SceneGroup>();
  for (const row of rows) {
    let group = bySceneId.get(row.scenePlanId);
    if (!group) {
      group = { scenePlanId: row.scenePlanId, rows: [] };
      bySceneId.set(row.scenePlanId, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/**
 * Real Dynamic Scene Table UI (Phase 6's sceneTableRowSchema, wired for
 * real), grouped visually by scenePlanId with rowSpan on scene-level
 * columns - a composition can have multiple placeholder-mapping rows
 * (Phase 7B / dashboard-integration requirement), never collapsed into
 * one. Never renders a semantic guess (image/logo/phone/...) unless
 * `placeholderClassification.value` actually carries one - "unknown"
 * stays "Unknown", a first-class state, not an error.
 */
export function SceneTable({ rows, disabled = false, onToggleUse, onMove, onEditScene }: SceneTableProps): ReactElement {
  const { t } = useLocale();

  if (rows.length === 0) {
    return <EmptyState title={t.sceneTable.emptyTitle} description={t.sceneTable.emptyDescription} />;
  }

  const groups = groupByScene(rows);

  return (
    <div className="table-scroll scene-table-scroll">
      <table className="scene-table">
        <caption className="visually-hidden">{t.sceneTable.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col" className="scene-table__sticky">
              {t.sceneTable.useColumn}
            </th>
            <th scope="col" className="scene-table__sticky">
              {t.sceneTable.finalOrderColumn}
            </th>
            <th scope="col">{t.sceneTable.sourcePositionColumn}</th>
            <th scope="col" className="scene-table__sticky">
              {t.sceneTable.sceneColumn}
            </th>
            <th scope="col">{t.sceneTable.mappingColumn}</th>
            <th scope="col">{t.sceneTable.assetColumn}</th>
            <th scope="col">{t.sceneTable.textColumn}</th>
            <th scope="col">{t.sceneTable.assetTimestampColumn}</th>
            <th scope="col">{t.sceneTable.finalDurationColumn}</th>
            <th scope="col" className="scene-table__sticky">
              {t.sceneTable.statusColumn}
            </th>
            <th scope="col">{t.sceneTable.notesColumn}</th>
            <th scope="col">{t.sceneTable.actionsColumn}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const first = group.rows[0]!;
            return group.rows.map((row, index) => (
              <tr key={row.mappingId ?? `${row.scenePlanId}-empty`} className={index === 0 ? "scene-table__group-start" : undefined}>
                {index === 0 ? (
                  <>
                    <td rowSpan={group.rows.length} className="scene-table__sticky">
                      <input
                        type="checkbox"
                        checked={first.use}
                        disabled={disabled}
                        onChange={(event) => onToggleUse(first.scenePlanId, event.target.checked)}
                        aria-label={t.sceneTable.includeSceneAriaLabel(first.compositionName)}
                      />
                    </td>
                    <td rowSpan={group.rows.length} className="scene-table__sticky scene-table__order-cell">
                      <span>{first.finalOrder ?? "—"}</span>
                      <span className="scene-table__order-buttons">
                        <button
                          type="button"
                          className="scene-table__order-button"
                          disabled={disabled}
                          onClick={() => onMove(first.scenePlanId, "up")}
                          aria-label={t.sceneTable.moveUp}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="scene-table__order-button"
                          disabled={disabled}
                          onClick={() => onMove(first.scenePlanId, "down")}
                          aria-label={t.sceneTable.moveDown}
                        >
                          ▼
                        </button>
                      </span>
                    </td>
                    <td rowSpan={group.rows.length}>{first.sourcePosition}</td>
                    <td rowSpan={group.rows.length} className="scene-table__sticky">
                      {first.compositionName}
                    </td>
                  </>
                ) : null}
                <td>{row.placeholderLabel ?? t.sceneTable.noMappingDetected}</td>
                <td>{row.selectedAssetId ?? t.sceneTable.noAssetsUploaded}</td>
                <td>{row.text ? t.sceneTable.hasText : t.sceneTable.noText}</td>
                <td>{formatSeconds(row.assetTimestamp)}</td>
                {index === 0 ? (
                  <>
                    <td rowSpan={group.rows.length}>{formatSeconds(first.finalDuration)}</td>
                    <td rowSpan={group.rows.length} className="scene-table__sticky">
                      <RowApprovalBadge state={first.approvalState} />
                    </td>
                    <td rowSpan={group.rows.length}>{formatNotesAndInstructions(first.instructions, first.notes)}</td>
                    <td rowSpan={group.rows.length}>
                      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onEditScene(first.scenePlanId)}>
                        {t.sceneTable.editRow}
                      </Button>
                    </td>
                  </>
                ) : null}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
