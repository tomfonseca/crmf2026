import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { parseFilters, type Filters } from "./demo/data";
export function useFilters() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const location = useLocation();
  const filters = parseFilters(search);
  return {
    filters,
    update: (patch: Partial<Filters>) =>
      void navigate({
        to:
          location.pathname === "/minhas-metas"
            ? "/minhas-metas"
            : "/meu-desempenho",
        search: { ...filters, ...patch },
      }),
  };
}
