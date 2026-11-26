import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useScope } from "@crmf/auth";
import { NetworkFailure, type NetworkClient } from "./networks-client";
import {
  StoreScreens,
  type StoreRecord,
  type StoreDraft,
} from "./StoreScreens";
import {
  StoreFailure,
  storeMessage,
  isStoreID,
  type StoreClient,
  type HQStore,
} from "./stores-client";
function presentation(s: HQStore): StoreRecord {
  return {
    id: s.id,
    networkId: s.tenant_id,
    networkName: s.network_name,
    networkSlug: s.network_slug,
    code: s.code,
    name: s.name,
    city: s.city,
    uf: s.uf,
    timezone: s.timezone,
    active: s.status === "active",
    version: s.version,
  };
}
export function Stores({
  route,
  navigate,
  networks,
  client,
  onExpired,
}: {
  route: string;
  navigate: (p: string) => void;
  networks?: NetworkClient;
  client?: StoreClient;
  onExpired: () => void;
}) {
  const scope = useScope(),
    canWrite = scope.grants.some((g) => g.role === "platform_admin");
  const path = route.split("?")[0],
    creating = path === "/stores/new",
    listing = path === "/stores";
  const rawID = path.split("/")[2] ?? "",
    id = isStoreID(rawID) ? rawID : "";
  const [after, setAfter] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  const cache = useQueryClient();
  const list = useQuery({
    queryKey: ["hq-stores", after],
    enabled: listing && !!client,
    queryFn: ({ signal }) => client!.list(after, signal),
  });
  const detail = useQuery({
    queryKey: ["hq-store", id],
    enabled: !!id && !!client,
    queryFn: ({ signal }) => client!.get(id, signal),
  });
  const available = useInfiniteQuery({
    queryKey: ["hq-store-networks"],
    enabled: creating && canWrite && !!networks,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => networks!.list(pageParam, signal),
    getNextPageParam: (p) => p.next_cursor,
  });
  useEffect(() => {
    if (
      [list.error, detail.error, available.error].some(
        (e) =>
          (e instanceof StoreFailure || e instanceof NetworkFailure) &&
          e.status === 401,
      )
    )
      onExpired();
  }, [list.error, detail.error, available.error, onExpired]);
  const options = available.isError
    ? []
    : (available.data?.pages
        .flatMap((p) => p.items)
        .filter(
          (n) =>
            n.provision_status === "ready" &&
            ["trial", "active"].includes(n.status),
        )
        .map((n) => ({
          id: n.id,
          name: n.profile?.data.display_name || n.legal_name,
          slug: n.slug,
          defaultTimezone: n.profile?.data.default_timezone,
        })) ?? []);
  const record = detail.isSuccess ? detail.data : undefined;
  if (record && !options.some((n) => n.id === record.tenant_id))
    options.push({
      id: record.tenant_id,
      name: record.network_name,
      slug: record.network_slug,
      defaultTimezone: undefined,
    });
  const records = listing
    ? list.isSuccess
      ? list.data.items.map(presentation)
      : []
    : record
      ? [presentation(record)]
      : [];
  const query = listing ? list : detail;
  async function save(
    input: StoreDraft,
    original: StoreRecord | undefined,
    signal: AbortSignal,
  ) {
    if (!client || !canWrite || input.active === null)
      throw new StoreFailure(403);
    const fields = {
      code: input.code,
      name: input.name,
      city: input.city,
      uf: input.uf,
      timezone: input.timezone,
      erp: "linx_big" as const,
      status: input.active ? ("active" as const) : ("inactive" as const),
    };
    try {
      const result = original
        ? await client.update(
            original.id,
            { ...fields, version: original.version ?? 0 },
            signal,
          )
        : await client.create(
            { ...fields, tenant_id: input.networkId },
            signal,
          );
      if (original && result.tenant_id !== original.networkId)
        throw new StoreFailure(502);
      return presentation(result);
    } catch (e) {
      if (e instanceof StoreFailure && e.status === 401) onExpired();
      throw e;
    }
  }
  return (
    <>
      {query.isError && (
        <p className="stores-notice stores-notice-danger" role="alert">
          {storeMessage(query.error)}
        </p>
      )}
      <StoreScreens
        route={route}
        navigate={navigate}
        canWrite={canWrite}
        records={records}
        connected={!!client}
        state={
          !client
            ? "unavailable"
            : query.isError
              ? "error"
              : query.isPending
                ? "loading"
                : records.length
                  ? "loaded"
                  : "empty"
        }
        networks={options}
        networkState={
          !creating
            ? record
              ? "ready"
              : "unavailable"
            : !networks
              ? "unavailable"
              : available.isPending
                ? "loading"
                : available.isError
                  ? "error"
                  : "ready"
        }
        onReloadNetworks={() => void available.refetch()}
        onReloadStores={() => void query.refetch()}
        onSave={client && canWrite ? save : undefined}
        onSaved={(saved) => {
          void cache.invalidateQueries({ queryKey: ["hq-stores"] });
          void cache.invalidateQueries({ queryKey: ["hq-store", saved.id] });
          navigate(`/stores/${saved.id}`);
        }}
        moreNetworks={
          <>
            {available.hasNextPage && (
              <button
                type="button"
                disabled={available.isFetchingNextPage}
                onClick={() => void available.fetchNextPage()}
              >
                Carregar mais redes
              </button>
            )}
            {creating && available.isSuccess && !options.length && (
              <p>Nenhuma rede preparada e ativa/em avaliação foi carregada.</p>
            )}
          </>
        }
        pagination={
          listing &&
          client && (
            <nav
              className="stores-table-footer"
              aria-label="Paginação de lojas"
            >
              <button
                disabled={list.isFetching}
                onClick={() => void list.refetch()}
              >
                Atualizar lojas
              </button>
              <span>Filtros nesta página</span>
              <button
                disabled={!history.length}
                onClick={() => {
                  setAfter(history.at(-1) ?? "");
                  setHistory((h) => h.slice(0, -1));
                }}
              >
                Página anterior
              </button>
              <button
                disabled={!list.data?.next_cursor}
                onClick={() => {
                  if (list.data?.next_cursor) {
                    setHistory((h) => [...h, after]);
                    setAfter(list.data.next_cursor);
                  }
                }}
              >
                Próxima página
              </button>
            </nav>
          )
        }
      />
    </>
  );
}
