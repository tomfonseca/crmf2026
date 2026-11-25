import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import type { Realm } from "./client";
export type Theme = "light" | "dark";
const preference = "crmf.auth.theme";
export function useAuthTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(preference) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  return [
    theme,
    () => {
      const next = theme === "light" ? "dark" : "light";
      setTheme(next);
      try {
        localStorage.setItem(preference, next);
      } catch {
        /* Storage is optional; authentication never depends on it. */
      }
    },
  ];
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    moon: "M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z",
    sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    key: "M14 4a6 6 0 0 0-5 9L3 19v2h4v-3h3l3-3a6 6 0 1 0 1-11Zm3 3v1",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    check: "m5 12 4 4L19 6",
    mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
    warning: "M12 3 2 21h20L12 3Zm0 6v5m0 3v1",
    lock: "M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3",
    arrow: "m12 5-7 7 7 7M5 12h14",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.warning} />
    </svg>
  );
}
export function Brand({ realm }: { realm: Realm }) {
  return (
    <div className="auth-brand">
      <span className="auth-brand-mark" aria-hidden="true">
        C
      </span>
      <span>CRM Farma</span>
      {realm === "platform" && <span className="auth-realm">QG</span>}
    </div>
  );
}
export function ThemeButton({
  theme,
  toggle,
}: {
  theme: Theme;
  toggle: () => void;
}) {
  return (
    <button
      type="button"
      className="auth-theme auth-secondary"
      onClick={toggle}
      aria-label={`Usar tema ${theme === "light" ? "escuro" : "claro"}`}
      title={`Usar tema ${theme === "light" ? "escuro" : "claro"}`}
    >
      <Icon name={theme === "light" ? "moon" : "sun"} />
    </button>
  );
}
export function Banner({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "danger" | "ok" | "neutral";
}) {
  return (
    <div
      className={`auth-banner auth-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
    >
      <Icon name={tone === "ok" ? "check" : "warning"} />
      <div>{children}</div>
    </div>
  );
}
export function AuthFrame({
  children,
  realm,
  theme,
  toggle,
  split = false,
  wide = false,
  footer,
  status = false,
}: {
  children: ReactNode;
  realm: Realm;
  theme: Theme;
  toggle: () => void;
  split?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  status?: boolean;
}) {
  return (
    <main
      className={`auth-app ${split ? "auth-split" : "auth-centered"}`}
      data-theme={theme}
    >
      <section className={split ? "auth-login-column" : "auth-center-column"}>
        <div className={`auth-content ${wide ? "auth-wide" : ""}`}>
          <Brand realm={realm} />
          <section
            className={`${split ? "auth-login-form" : "auth-panel"} ${status ? "auth-status" : ""}`}
            aria-labelledby="auth-title"
          >
            {children}
          </section>
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
        <ThemeButton theme={theme} toggle={toggle} />
      </section>
      {split && (
        <div
          className="auth-cover"
          role="img"
          aria-label="Espaço para a imagem de capa"
        >
          [Imagem de capa]
        </div>
      )}
    </main>
  );
}
export function StatusIcon({
  icon = "warning",
  tone = "info",
}: {
  icon?: string;
  tone?: string;
}) {
  return (
    <div className={`auth-status-icon auth-${tone}`}>
      <Icon name={icon} />
    </div>
  );
}
export function PasswordField({
  label = "Senha",
  error,
  help,
  aside,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  help?: ReactNode;
  aside?: ReactNode;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-field">
      <div className="auth-field-heading">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="auth-password">
        <input
          {...props}
          id={id}
          type={shown ? "text" : "password"}
          aria-invalid={!!error}
          aria-describedby={error || help ? `${id}-help` : undefined}
        />
        <button
          className="auth-eye"
          type="button"
          aria-label={shown ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
          disabled={props.disabled}
        >
          <Icon name="eye" />
        </button>
      </div>
      {(error || help) && (
        <small id={`${id}-help`} className={error ? "auth-field-error" : ""}>
          {error ?? help}
        </small>
      )}
    </div>
  );
}
export function PasswordRules({ password }: { password: string }) {
  const valid = Array.from(password).length >= 12;
  return (
    <ul className="auth-password-rules">
      <li className={valid ? "auth-rule-ok" : ""}>
        {valid ? "✓" : "○"} Mínimo de 12 caracteres
      </li>
      <li>○ Não pode ser uma senha comum (conferida no servidor ao salvar)</li>
    </ul>
  );
}
export function Planned() {
  return <span className="auth-planned">Previsto</span>;
}
