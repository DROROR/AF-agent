import type { HTMLAttributes, ReactElement, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  sunken?: boolean;
}

export function Card({ sunken, className, ...rest }: CardProps): ReactElement {
  const classes = ["card", sunken ? "card--sunken" : null, className].filter(Boolean).join(" ");
  return <div className={classes} {...rest} />;
}

export interface CardHeaderProps {
  title: ReactNode;
  action?: ReactNode;
  id?: string;
}

export function CardHeader({ title, action, id }: CardHeaderProps): ReactElement {
  return (
    <div className="card__header">
      <h2 id={id}>{title}</h2>
      {action ?? null}
    </div>
  );
}
