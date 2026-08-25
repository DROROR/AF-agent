import type { ReactElement, SelectHTMLAttributes } from "react";

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  return <select className={["select", className].filter(Boolean).join(" ")} {...rest} />;
}
