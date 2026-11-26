// Imported only by the development design gallery; never a live API fallback.
import {
  StoreScreens,
  type StoreHealth,
  type StoreRecord,
} from "./StoreScreens";
const sample: StoreRecord = {
  id: "sample",
  code: "S001",
  name: "Loja sintética",
  networkId: "demo-network",
  networkName: "Rede de demonstração",
  networkSlug: "demo_network",
  city: "Cidade de demonstração",
  uf: "RJ",
  timezone: "America/Sao_Paulo",
  active: true,
  health: "ok",
  lastUpdate: "há 4 min",
  agent: {
    id: "DEV-DEMO",
    system: "Windows Server · x64",
    version: "1.4.2",
    versions: "agente 1.4.2 · updater 1.1.0 · conector Linx Big (exemplo)",
    pairedAt: "12/11/2026, 16:40",
    heartbeat: "há 1 min",
    lastBatch: "há 4 min · #DEMO-1",
  },
  batches: [
    {
      id: "#DEMO-1",
      flow: "vendas",
      window: "25/11 14:00–14:15",
      status: "Processado",
    },
    {
      id: "#DEMO-2",
      flow: "vendas",
      window: "25/11 13:45–14:00",
      status: "Processado",
    },
    {
      id: "#DEMO-3",
      flow: "cadastros",
      window: "25/11 13:00–14:00",
      status: "Processado",
    },
  ],
};
function withHealth(health: StoreHealth): StoreRecord {
  if (health === "no-data")
    return {
      ...sample,
      health,
      agent: null,
      batches: [],
      lastUpdate: undefined,
    };
  const age =
    health === "late"
      ? "há 12 min"
      : health === "offline"
        ? "há 25 min"
        : "há 4 min";
  return {
    ...sample,
    health,
    lastUpdate: age,
    agent: {
      ...sample.agent!,
      heartbeat: health === "offline" ? "há 20 min" : "há 1 min",
      lastBatch: age + " · #DEMO-1",
    },
  };
}
export function StorePreview({
  base,
  variant,
  title,
  support,
  navigate,
}: {
  base: string;
  variant: string;
  title: string;
  support: boolean;
  navigate: (path: string) => void;
}) {
  const healthMap: Record<string, StoreHealth> = {
    "situacao-atrasado": "late",
    "situacao-offline": "offline",
    "situacao-sem-vendas": "no-sales",
    "situacao-sem-dados": "no-data",
  };
  const health = healthMap[variant] ?? "ok";
  const record = {
    ...withHealth(health),
    name: base === "QG-Loja" ? title : sample.name,
  };
  const records =
    base === "QG-Lojas"
      ? (["ok", "late", "no-data", "offline", "no-sales"] as const).map(
          (h, i) => ({
            ...withHealth(h),
            id: `sample-${i}`,
            code: `S00${i + 1}`,
            name: `Loja sintética ${i + 1}`,
            ...(i >= 3
              ? {
                  networkId: "demo-network-2",
                  networkName: "Rede de demonstração 2",
                  networkSlug: "demo_network_2",
                }
              : {}),
          }),
        )
      : [record];
  const route =
    base === "QG-Lojas"
      ? "/stores"
      : base === "QG-Loja-Form"
        ? variant === "modo-editar"
          ? "/stores/sample/edit"
          : "/stores/new"
        : "/stores/sample";
  const state =
    variant === "carregando"
      ? "loading"
      : variant === "erro"
        ? "error"
        : variant === "vazio"
          ? "empty"
          : "loaded";
  return (
    <StoreScreens
      key={base + variant}
      route={route}
      navigate={navigate}
      canWrite={!support}
      state={state}
      records={state === "empty" ? [] : records}
      networks={[
        {
          id: sample.networkId,
          name: sample.networkName,
          slug: sample.networkSlug,
        },
      ]}
      networkState="ready"
      preview
      variant={variant}
      title={title}
    />
  );
}
