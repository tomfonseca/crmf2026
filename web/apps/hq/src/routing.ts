import { useEffect, useState } from "react";
export function useQGRoute() {
  const [path, setPath] = useState(
    window.location.pathname + window.location.search,
  );
  useEffect(() => {
    const pop = () =>
      setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(next: string) {
    if (!next.startsWith("/") || next.startsWith("//")) return;
    const dirty = document.querySelector("form[data-dirty=true]");
    if (dirty && !window.confirm("Descartar alterações não salvas?")) return;
    window.history.pushState(null, "", next);
    setPath(next);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#qg-content h1")?.focus(),
    );
  }
  return [path, navigate] as const;
}
