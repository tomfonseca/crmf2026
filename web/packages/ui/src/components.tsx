import type { ReactNode } from "react";

const icons = {
  dashboard: "M4 4h6v8H4zM14 4h6v4h-6zM4 16h6v4H4zM14 12h6v8h-6z",
  target:
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M11 12h2",
  cash: "M3 6h18v12H3zM10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M6 9h.01M18 15h.01",
  users:
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2M16 3a4 4 0 0 1 0 8M21 21v-2a4 4 0 0 0 -3 -4",
  cart: "M4 3h2v14h13M6 5l14 1l-1 7H6M7 20h.01M18 20h.01",
  box: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
  heart: "M20 12l-8 8l-8 -8a5 5 0 0 1 8 -6a5 5 0 0 1 8 6",
  pie: "M10 3a9 9 0 1 0 11 11H12a2 2 0 0 1 -2 -2zM15 3v6h6a9 9 0 0 0 -6 -6",
  store:
    "M3 21h18M3 7l2 -4h14l2 4M3 7v2a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0V7zM5 12v9M19 12v9M9 21v-6h6v6",
  search: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6",
  sun: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 12h1M12 3v1M20 12h1M12 20v1M5 5l1 1M18 18l1 1M5 19l1 -1M18 6l1 -1",
  moon: "M12 3a7.5 7.5 0 0 0 9 10a9 9 0 1 1 -9 -10",
  bell: "M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3l2 3H4l2 -3v-3a7 7 0 0 1 4 -6M9 20h6",
  menu: "M4 4h16v16H4zM9 4v16M15 10l-2 2l2 2",
  chevron: "M6 9l6 6l6 -6",
  refresh:
    "M20 7a8 8 0 0 0 -14 -2L4 9h5M4 4v5M4 17a8 8 0 0 0 14 2l2 -4h-5M20 20v-5",
  help: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M9 9a3 3 0 0 1 6 0c0 2 -3 2 -3 4M12 17h.01",
  close: "M6 6l12 12M6 18L18 6",
  download: "M4 17v4h16v-4M7 11l5 5l5 -5M12 4v12",
  arrow: "M5 12h14M14 7l5 5l-5 5",
  alert: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 8v4M12 16h.01",
} satisfies Record<string, string>;

export function Icon({
  name,
  size = 20,
}: {
  name: keyof typeof icons;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: keyof typeof icons;
}) {
  return (
    <article className="kpi">
      <div className="kpi-label">
        <span>{label}</span>
        {icon && <Icon name={icon} />}
      </div>
      <strong
        className={
          value.startsWith("Sem") ? "kpi-value is-unavailable" : "kpi-value"
        }
      >
        {value}
      </strong>
      {hint && <span className="muted small">{hint}</span>}
    </article>
  );
}
export function Progress({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number | null;
  muted?: boolean;
}) {
  return (
    <div className="progress-group">
      <div>
        <span>{label}</span>
        <b>
          {value === null
            ? "Sem base"
            : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
        </b>
      </div>
      <div
        className={`progress ${muted ? "progress--muted" : ""}`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={
          value === null ? undefined : Math.min(100, Math.max(0, value))
        }
        aria-valuetext={value === null ? "Sem base" : `${value.toFixed(1)}%`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name="dashboard" size={28} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
