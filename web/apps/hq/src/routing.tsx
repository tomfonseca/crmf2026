import { useEffect, useRef, useState } from "react";
import { PlanDialog } from "./PlanPresentation";
const key = "crmfQGPosition";
function current() {
  return window.location.pathname + window.location.search;
}
function dirty() {
  return !!document.querySelector("form[data-dirty=true]");
}
export function useQGRoute() {
  const [path, setPath] = useState(current),
    [pending, setPending] = useState<{ proceed: () => void } | null>(null);
  const position = useRef<number>(Number(window.history.state?.[key]) || 0),
    reverting = useRef<null | (() => void)>(null);
  const focus = () =>
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#qg-content h1")?.focus(),
    );
  function requestLeave(proceed: () => void) {
    if (document.querySelector("form[data-saving=true]")) return;
    if (dirty()) setPending({ proceed });
    else proceed();
  }
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, [key]: position.current },
      "",
    );
    function pop() {
      if (reverting.current) {
        const complete = reverting.current;
        reverting.current = null;
        complete();
        return;
      }
      const next =
        typeof window.history.state?.[key] === "number"
          ? window.history.state[key]
          : position.current - 1;
      if (dirty() || document.querySelector("form[data-saving=true]")) {
        const delta = next - position.current;
        if (!delta) return;
        const saving = !!document.querySelector("form[data-saving=true]");
        reverting.current = () => {
          if (!saving) setPending({ proceed: () => window.history.go(delta) });
        };
        window.history.go(-delta);
      } else {
        position.current = next;
        window.history.replaceState(
          { ...window.history.state, [key]: next },
          "",
        );
        setPath(current());
        focus();
      }
    }
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(next: string) {
    if (!next.startsWith("/") || next.startsWith("//")) return;
    requestLeave(() => {
      const pageChanged = next.split("?")[0] !== window.location.pathname;
      position.current++;
      window.history.pushState({ [key]: position.current }, "", next);
      setPath(next);
      if (pageChanged) focus();
    });
  }
  const dialog = pending ? (
    <PlanDialog
      compact
      title="Descartar alterações?"
      onClose={() => setPending(null)}
    >
      <div className="plans-dialog-body">
        <p>
          As alterações feitas{" "}
          {document.querySelector<HTMLFormElement>("form[data-dirty=true]")
            ?.dataset.draftLabel ?? "neste plano"}{" "}
          ainda não foram salvas e serão perdidas.
        </p>
      </div>
      <footer className="plans-dialog-actions">
        <button data-initial-focus onClick={() => setPending(null)}>
          Continuar editando
        </button>
        <button
          className="plans-outline-danger"
          onClick={() => {
            document
              .querySelectorAll<HTMLFormElement>("form[data-dirty=true]")
              .forEach((form) => {
                form.dataset.dirty = "false";
              });
            const proceed = pending.proceed;
            setPending(null);
            proceed();
          }}
        >
          Descartar
        </button>
      </footer>
    </PlanDialog>
  ) : null;
  return [path, navigate, { requestLeave, dialog }] as const;
}
