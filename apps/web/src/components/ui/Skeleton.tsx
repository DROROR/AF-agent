import type { ReactElement } from "react";

export interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({ width = "100%", height = "1rem", className }: SkeletonProps): ReactElement {
  return (
    <span
      className={["skeleton", className].filter(Boolean).join(" ")}
      style={{ display: "inline-block", width, height }}
      aria-hidden="true"
    />
  );
}
