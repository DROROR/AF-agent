import type { ReactElement } from "react";
import type { SceneTableRow } from "../lib/scene-table-types";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { StatusBadge } from "./StatusBadge";

export interface SceneTableProps {
  rows: SceneTableRow[];
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

function approvalBadge(state: SceneTableRow["approvalState"]): ReactElement {
  if (state === "approved") {
    return <StatusBadge status="OK" />;
  }
  if (state === "rejected") {
    return <StatusBadge status="ERROR" />;
  }
  return <StatusBadge status="UNKNOWN" />;
}

/**
 * Phase 6 scene/placeholder approval editor - presentational only, no
 * fetching, no mutation. Real rows will come from a future execution-plan
 * API; until then every call site passes an empty array, which renders an
 * honest empty state rather than inventing placeholder rows.
 */
export function SceneTable({ rows }: SceneTableProps): ReactElement {
  const { t } = useLocale();

  if (rows.length === 0) {
    return <EmptyState title={t.sceneTable.emptyTitle} description={t.sceneTable.emptyDescription} />;
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">{t.sceneTable.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.sceneTable.useColumn}</th>
            <th scope="col">{t.sceneTable.orderColumn}</th>
            <th scope="col">{t.sceneTable.sceneColumn}</th>
            <th scope="col">{t.sceneTable.placeholderColumn}</th>
            <th scope="col">{t.sceneTable.typeColumn}</th>
            <th scope="col">{t.sceneTable.assetColumn}</th>
            <th scope="col">{t.sceneTable.textColumn}</th>
            <th scope="col">{t.sceneTable.sourceTimeColumn}</th>
            <th scope="col">{t.sceneTable.finalDurationColumn}</th>
            <th scope="col">{t.sceneTable.notesColumn}</th>
            <th scope="col">{t.sceneTable.approvalColumn}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.placeholderId}>
              <td>{row.use ? t.common.yes : t.common.no}</td>
              <td>{row.finalOrder ?? "—"}</td>
              <td>{row.sceneLabel}</td>
              <td>{row.placeholderLabel}</td>
              <td>{t.sceneTable.placeholderType[row.placeholderType]}</td>
              <td>{row.assetName ?? "—"}</td>
              <td>{row.hasText ? t.sceneTable.hasText : t.sceneTable.noText}</td>
              <td>{formatSeconds(row.sourceTimestampSeconds)}</td>
              <td>{formatSeconds(row.finalDurationSeconds)}</td>
              <td>{row.notes || "—"}</td>
              <td>{approvalBadge(row.approvalState)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
