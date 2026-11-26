import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Plan } from "./plans-client";
import { Pill } from "./OperationalScreens";
export function PlanIcon({
  name,
}: {
  name: "plus" | "edit" | "trash" | "search" | "refresh";
}) {
  const paths = {
    plus: "M12 5v14M5 12h14",
    edit: "M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4",
    trash:
      "M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3",
    search: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-6-6",
    refresh:
      "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function PlanDialog({
  title,
  onClose,
  children,
  compact = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const prior = document.activeElement;
    const el = ref.current!;
    el.showModal();
    el.querySelector<HTMLElement>("[data-initial-focus],input,button")?.focus();
    return () => {
      el.close();
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, []);
  return (
    <dialog
      className={"plans-modal" + (compact ? " plans-discard" : "")}
      ref={ref}
      role="alertdialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
      </header>
      {children}
    </dialog>
  );
}
function Card({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  const id = useId();
  return (
    <section className="plans-form-card" aria-labelledby={id}>
      <header>
        <h2 id={id}>{title}</h2>
        {description && <small>{description}</small>}
      </header>
      <div className="plans-card-body">{children}</div>
    </section>
  );
}
export function PlanFields({
  original,
  unlimitedStores,
  unlimitedUsers,
  setUnlimitedStores,
  setUnlimitedUsers,
}: {
  original?: Plan;
  unlimitedStores: boolean;
  unlimitedUsers: boolean;
  setUnlimitedStores: (v: boolean) => void;
  setUnlimitedUsers: (v: boolean) => void;
}) {
  return (
    <div className="plans-form-grid">
      <Card title="Identificação">
        <div className="plans-field">
          <label htmlFor="plan-code">Código</label>
          <input
            id="plan-code"
            name="code"
            required
            pattern="[a-z0-9][a-z0-9_-]{0,63}"
            maxLength={64}
            readOnly={!!original}
            defaultValue={original?.code}
            aria-describedby="plan-code-help"
          />
          <small id="plan-code-help">
            {original
              ? "O código é imutável."
              : "Identificador imutável, em letras minúsculas, números, _ ou -."}
          </small>
        </div>
        <div className="plans-field">
          <label htmlFor="plan-name">
            Nome{" "}
            <span className="plans-required" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="plan-name"
            name="name"
            aria-label="Nome"
            required
            maxLength={120}
            defaultValue={original?.name}
            aria-describedby="plan-name-help"
          />
          <small id="plan-name-help">
            Nome exibido no QG e para a rede no Dash.
          </small>
        </div>
      </Card>
      <Card title="Preço e dados">
        <div className="plans-field">
          <label htmlFor="plan-price">Preço mensal</label>
          <div className="plans-unit">
            <input
              id="plan-price"
              name="price"
              aria-label="Preço (R$)"
              required
              inputMode="decimal"
              maxLength={11}
              defaultValue={
                original
                  ? `${Math.floor(original.price_cents / 100)},${String(original.price_cents % 100).padStart(2, "0")}`
                  : ""
              }
              aria-describedby="plan-price-help"
            />
            <span>R$</span>
          </div>
          <small id="plan-price-help">
            Em reais, com vírgula. Zero é permitido.
          </small>
        </div>
        <div className="plans-field">
          <label htmlFor="plan-sync">Intervalo de sincronização</label>
          <div className="plans-unit">
            <input
              id="plan-sync"
              name="sync"
              aria-label="Intervalo de sincronização (minutos)"
              type="number"
              min={1 / 60}
              max={2147483647 / 60}
              step="any"
              required
              defaultValue={
                original ? original.sync_interval_seconds / 60 : undefined
              }
              aria-describedby="plan-sync-help"
            />
            <span>minutos</span>
          </div>
          <small id="plan-sync-help">
            Frequência de envio dos dados pela loja.
          </small>
        </div>
        <div className="plans-field">
          <label htmlFor="plan-history">Histórico disponível</label>
          <div className="plans-unit">
            <input
              id="plan-history"
              name="history"
              aria-label="Histórico (meses)"
              type="number"
              min={1}
              max={2147483647}
              step={1}
              required
              defaultValue={original?.history_months}
              aria-describedby="plan-history-help"
            />
            <span>meses</span>
          </div>
          <small id="plan-history-help">
            Período máximo consultável no Dash.
          </small>
        </div>
      </Card>
      <Card
        title="Limites"
        description="Ao atingir o limite, novas lojas ou usuários são recusados"
      >
        {(
          [
            [
              "stores",
              "lojas",
              unlimitedStores,
              setUnlimitedStores,
              original?.max_stores,
            ],
            [
              "users",
              "usuários",
              unlimitedUsers,
              setUnlimitedUsers,
              original?.max_users,
            ],
          ] as const
        ).map(([key, label, unlimited, setUnlimited, value]) => (
          <div className="plans-field" key={key}>
            <label htmlFor={"plan-" + key}>Máximo de {label}</label>
            <div className="plans-limit">
              <input
                id={"plan-" + key}
                aria-label={"Máximo de " + label + " (vazio = ilimitado)"}
                name={key}
                type="number"
                min={1}
                max={2147483647}
                step={1}
                defaultValue={value ?? ""}
                disabled={unlimited}
                required={!unlimited}
                aria-describedby={"plan-" + key + "-help"}
              />
              <label className="plans-check">
                <input
                  type="checkbox"
                  aria-label={"Ilimitado — " + label}
                  checked={unlimited}
                  onChange={(e) => setUnlimited(e.target.checked)}
                />
                Ilimitado
              </label>
            </div>
            <small id={"plan-" + key + "-help"}>
              Número inteiro positivo, ou marque “Ilimitado”.
            </small>
          </div>
        ))}
      </Card>
      <Card title="Módulos">
        {(
          [
            ["core", "indicadores, mix, produtos, lojas, vendedores, metas"],
            ["realtime", "tela Hoje e atualização a cada 60 s"],
            ["export", "exportação de relatórios em CSV"],
            ["pulse", "aplicativo móvel Pulse"],
          ] as const
        ).map(([module, description]) => (
          <div className="plans-module" key={module}>
            <label className="plans-check">
              <input
                name="module"
                type="checkbox"
                value={module}
                aria-label={module}
                disabled={module === "pulse"}
                defaultChecked={original?.modules.includes(module)}
              />
              <span>
                <strong>{module}</strong> · {description}
              </span>
            </label>
            {module === "pulse" && <Pill tone="warn">Previsto · fase 2</Pill>}
          </div>
        ))}
        {original?.modules.includes("pulse") && (
          <input type="hidden" name="module" value="pulse" />
        )}
        <small className="plans-modules-help">
          Sem seleção, nenhum módulo é liberado.
        </small>
      </Card>
      <Card title="Situação">
        <div className="plans-status">
          <input
            id="plan-active"
            name="active"
            type="checkbox"
            role="switch"
            aria-label="Plano ativo"
            defaultChecked={original?.active ?? true}
          />
          <div>
            <label htmlFor="plan-active">Plano ativo</label>
            <p>
              Desativar não suspende nem altera assinaturas existentes; o plano
              só deixa de poder ser escolhido para novas assinaturas.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
export function syncLabel(seconds: number) {
  if (seconds % 86400 === 0)
    return `${seconds / 86400} ${seconds === 86400 ? "dia" : "dias"}`;
  if (seconds % 3600 === 0)
    return `${seconds / 3600} ${seconds === 3600 ? "hora" : "horas"}`;
  if (seconds % 60 === 0)
    return `${seconds / 60} ${seconds === 60 ? "minuto" : "minutos"}`;
  return `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
}
