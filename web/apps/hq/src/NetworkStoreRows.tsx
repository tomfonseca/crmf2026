import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { StoreFailure, storeMessage, type StoreClient } from "./stores-client";
export function NetworkStoreRows({
  client,
  tenantId,
  navigate,
  onExpired,
}: {
  client: StoreClient;
  tenantId: string;
  navigate: (p: string) => void;
  onExpired: () => void;
}) {
  const q = useInfiniteQuery({
    queryKey: ["hq-network-stores", tenantId],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      client.list(pageParam, signal, tenantId),
    getNextPageParam: (p) => p.next_cursor,
  });
  useEffect(() => {
    if (q.error instanceof StoreFailure && q.error.status === 401) onExpired();
  }, [q.error, onExpired]);
  const items = q.isError ? [] : (q.data?.pages.flatMap((p) => p.items) ?? []);
  return (
    <>
      {q.isPending && <p role="status">Carregando lojas da rede…</p>}
      {q.isError && (
        <p role="alert">
          {storeMessage(q.error)}{" "}
          <button onClick={() => void q.refetch()}>Tentar novamente</button>
        </p>
      )}
      <div
        className="networks-detail-table"
        role="region"
        aria-label="Lojas da rede"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              {[
                "Loja",
                "Cidade/UF",
                "ERP",
                "Dados",
                "Dispositivo",
                "Última atualização",
              ].map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  <a
                    href={`/stores/${s.id}`}
                    onClick={(e) => {
                      if (
                        !e.ctrlKey &&
                        !e.metaKey &&
                        !e.shiftKey &&
                        !e.altKey
                      ) {
                        e.preventDefault();
                        navigate(`/stores/${s.id}`);
                      }
                    }}
                  >
                    {s.name}
                  </a>
                  <small>
                    {s.code} · {s.status === "active" ? "Ativa" : "Inativa"}
                  </small>
                </th>
                <td>{[s.city, s.uf].filter(Boolean).join(" / ") || "—"}</td>
                <td>Linx Big</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.isSuccess && !items.length && (
        <p>Nenhuma loja cadastrada nesta rede.</p>
      )}
      {q.hasNextPage && (
        <button
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          Carregar mais lojas
        </button>
      )}
      <p className="networks-help">
        Configuração cadastrada. Saúde, dispositivo e última atualização ainda
        não disponibilizados.
      </p>
    </>
  );
}
