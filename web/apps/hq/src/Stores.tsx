import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useScope } from "@crmf/auth";
import { NetworkFailure, type NetworkClient } from "./networks-client";
import { StoreScreens } from "./StoreScreens";

// There is no store API yet. Missing service is explicit, never an empty catalog
// or a fallback to development records. Only the existing network selector reads.
export function Stores({
  route,
  navigate,
  networks,
  onExpired,
}: {
  route: string;
  navigate: (path: string) => void;
  networks?: NetworkClient;
  onExpired: () => void;
}) {
  const scope = useScope();
  const canWrite = scope.grants.some((g) => g.role === "platform_admin");
  const creating = route.split("?")[0] === "/stores/new";
  const available = useInfiniteQuery({
    queryKey: ["hq-store-networks"],
    enabled: creating && canWrite && !!networks,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => networks!.list(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor,
  });
  useEffect(() => {
    if (
      available.error instanceof NetworkFailure &&
      available.error.status === 401
    )
      onExpired();
  }, [available.error, onExpired]);
  const options =
    available.data?.pages
      .flatMap((page) => page.items)
      .map((n) => ({
        id: n.id,
        name: n.profile?.data.display_name || n.legal_name,
        slug: n.slug,
      })) ?? [];
  return (
    <StoreScreens
      route={route}
      navigate={navigate}
      canWrite={canWrite}
      state="unavailable"
      networks={options}
      networkState={
        !creating || !networks
          ? "unavailable"
          : available.isPending
            ? "loading"
            : available.isError
              ? "error"
              : "ready"
      }
      onReloadNetworks={() => void available.refetch()}
      moreNetworks={
        available.hasNextPage && (
          <button
            type="button"
            disabled={available.isFetchingNextPage}
            onClick={() => void available.fetchNextPage()}
          >
            Carregar mais redes
          </button>
        )
      }
    />
  );
}
