import { StrictMode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StorePairing } from "./StorePairing";
import type { HQStore } from "./stores-client";
import type { PairingClient, PairingMeta } from "./pairing-client";
const id = "00000000-0000-7000-8000-000000000001",
  key = "00000000-0000-7000-8000-000000000002";
const store: HQStore = {
  id,
  tenant_id: id,
  network_name: "Rede sintética",
  network_slug: "synthetic",
  name: "Loja sintética",
  code: "S001",
  city: "",
  uf: "",
  timezone: "America/Sao_Paulo",
  erp: "linx_big",
  status: "active",
  version: 1,
};
const current: PairingMeta = {
  id: key,
  store_id: id,
  status: "pending",
  expires_at: "2026-12-01T12:00:00Z",
};
const generate = () => screen.getByRole("button", { name: "Gerar código" });
const confirm = () => screen.getByRole("button", { name: "Confirmar emissão" });
test("strict lifecycle loads dependencies and ignores a late secret after pagehide", async () => {
  let finish!: (v: Awaited<ReturnType<PairingClient["issue"]>>) => void;
  const client: PairingClient = {
    get: vi.fn(async () => undefined),
    issue: vi.fn(
      () =>
        new Promise<Awaited<ReturnType<PairingClient["issue"]>>>((r) => {
          finish = r;
        }),
    ),
    revoke: vi.fn(),
  };
  const refreshStore = vi.fn(async () => {});
  const view = render(
    <StrictMode>
      <StorePairing
        store={store}
        client={client}
        refreshStore={refreshStore}
        canWrite
        navigate={vi.fn()}
        onExpired={vi.fn()}
      />
    </StrictMode>,
  );
  await waitFor(() => expect(generate()).toBeEnabled());
  expect(refreshStore).toHaveBeenCalled();
  fireEvent.click(generate());
  fireEvent.click(confirm());
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    finish({ current, code: "ABCD2345" });
  });
  expect(screen.queryByLabelText("Código de pareamento")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("tela inativa");
  expect(client.issue).toHaveBeenCalledTimes(1);
  view.unmount();
});
test("secret expires on a bounded display timer without any API polling", async () => {
  const client: PairingClient = {
    get: vi.fn(async () => undefined),
    issue: vi.fn(async () => ({ current, code: "ABCD2345" })),
    revoke: vi.fn(),
  };
  const view = render(
    <StorePairing
      store={store}
      client={client}
      refreshStore={async () => {}}
      canWrite
      navigate={vi.fn()}
      onExpired={vi.fn()}
    />,
  );
  await waitFor(() => expect(generate()).toBeEnabled());
  fireEvent.click(generate());
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(screen.getByLabelText("Código de pareamento")).toHaveTextContent(
      "ABCD-2345",
    );
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.queryByLabelText("Código de pareamento")).toBeNull();
    expect(client.get).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
