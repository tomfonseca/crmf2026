import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NetworkEditor } from "./NetworkEditor";
import {
  emptyNetworkProfile,
  NetworkFailure,
  type NetworkClient,
  type NetworkProfileInput,
} from "./networks-client";
afterEach(cleanup);
function mount(lookup: NetworkClient["lookup"]) {
  const client: NetworkClient = {
    lookup,
    list: vi.fn(),
    create: vi.fn(),
    retry: vi.fn(),
    updateProfile: vi.fn(),
  };
  const expired = vi.fn();
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      <NetworkEditor
        client={client}
        plans={{
          list: vi.fn().mockResolvedValue({ items: [] }),
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
        }}
        onDone={vi.fn()}
        onCancel={vi.fn()}
        onPlans={vi.fn()}
        onExpired={expired}
      />
    </QueryClientProvider>,
  );
  return { client, expired, ...view };
}
it("discards stale CNPJ responses, preserves manual inputs and clears only previous suggestions", async () => {
  const pending: ((p: NetworkProfileInput) => void)[] = [];
  const lookup = vi.fn<NetworkClient["lookup"]>(
    () => new Promise<NetworkProfileInput>((resolve) => pending.push(resolve)),
  );
  mount(lookup);
  fireEvent.change(screen.getByLabelText("Nome da rede"), {
    target: { value: "Nome manual" },
  });
  fireEvent.change(screen.getByLabelText("Razão social"), {
    target: { value: "Razão manual" },
  });
  fireEvent.change(screen.getByLabelText("CNPJ sem pontuação"), {
    target: { value: "00000000000191" },
  });
  expect(lookup).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("CNPJ sem pontuação"), {
    target: { value: "00000000000272" },
  });
  expect(lookup.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () =>
    pending[1]({
      ...emptyNetworkProfile(),
      registered_name: "Sugestão B",
      display_name: "Fantasia B",
      city: "Cidade B",
      uf: "SP",
    }),
  );
  await act(async () =>
    pending[0]({
      ...emptyNetworkProfile(),
      registered_name: "Sugestão A",
      display_name: "Fantasia A",
      city: "Cidade A",
      uf: "RJ",
    }),
  );
  expect(screen.getByLabelText("Cidade")).toHaveValue("Cidade B");
  expect(screen.getByLabelText("UF")).toHaveValue("SP");
  expect(screen.getByLabelText("Nome da rede")).toHaveValue("Nome manual");
  expect(screen.getByLabelText("Razão social")).toHaveValue("Razão manual");
  fireEvent.change(screen.getByLabelText("Cidade"), {
    target: { value: "Cidade manual" },
  });
  fireEvent.change(screen.getByLabelText("CNPJ sem pontuação"), {
    target: { value: "000" },
  });
  expect(screen.getByLabelText("Cidade")).toHaveValue("Cidade manual");
  expect(screen.getByLabelText("UF")).toHaveValue("");
  expect(screen.getByLabelText("Razão social")).toHaveValue("Razão manual");
});
it("leaves manual entry available on lookup failure without persisting or creating anything", async () => {
  const { client } = mount(vi.fn().mockRejectedValue(new NetworkFailure(503)));
  fireEvent.change(screen.getByLabelText("CNPJ sem pontuação"), {
    target: { value: "00000000000191" },
  });
  expect(
    await screen.findByText(
      "Consulta indisponível. Você pode preencher manualmente.",
    ),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Razão social"), {
    target: { value: "Entrada manual" },
  });
  expect(screen.getByLabelText("Razão social")).toHaveValue("Entrada manual");
  expect(client.create).not.toHaveBeenCalled();
  expect(client.updateProfile).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it("aborts lookup on unmount and reports an expired authenticated session", async () => {
  const { expired, unmount } = mount(
    vi.fn().mockRejectedValue(new NetworkFailure(401)),
  );
  fireEvent.change(screen.getByLabelText("CNPJ sem pontuação"), {
    target: { value: "00000000000191" },
  });
  await screen.findByText(
    "Consulta indisponível. Você pode preencher manualmente.",
  );
  expect(expired).toHaveBeenCalledOnce();
  unmount();
  let signal: AbortSignal | undefined;
  const view = mount((_cnpj, s) => {
    signal = s;
    return new Promise(() => {});
  });
  fireEvent.change(screen.getByLabelText("CNPJ sem pontuação"), {
    target: { value: "00000000000191" },
  });
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
