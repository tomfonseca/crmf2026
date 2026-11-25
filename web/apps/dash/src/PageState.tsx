import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@crmf/ui";
import { useFilters } from "./filters";
export function useDemoRefresh() {
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const { update } = useFilters();
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    busy,
    updated,
    refresh: (recover = false) => {
      clearTimeout(timer.current);
      setBusy(true);
      timer.current = setTimeout(() => {
        if (recover) update({ scenario: "populated" });
        setBusy(false);
        setUpdated(true);
      }, 350);
    },
  };
}
export function PageState({
  busy,
  retry,
  children,
}: {
  busy: boolean;
  retry: () => void;
  children: ReactNode;
}) {
  const { filters } = useFilters();
  if (filters.from > filters.to)
    return (
      <div className="alert alert--error" role="alert">
        <Icon name="alert" />A data inicial não pode ser posterior à data final.
        Corrija o período nos filtros.
      </div>
    );
  if (busy || filters.scenario === "loading")
    return (
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-dot" />
        <strong>Carregando demonstração…</strong>
        <p className="muted">
          Simulação local. Nenhum serviço está sendo consultado.
        </p>
        <div className="skeleton-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <span className="skeleton" key={i} />
          ))}
        </div>
      </div>
    );
  if (filters.scenario === "error")
    return (
      <div className="alert alert--error" role="alert">
        <Icon name="alert" />
        <span>
          Não foi possível carregar os dados deste período. Erro simulado.
        </span>
        <button className="text-button" onClick={retry}>
          Tentar novamente
        </button>
      </div>
    );
  return <>{children}</>;
}
