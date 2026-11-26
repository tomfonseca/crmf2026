import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { NetworkDetail, NetworkSetup } from "./NetworkPresentation";
import type { Network } from "./networks-client";
const network: Network = {
  id: "00000000-0000-7000-8000-000000000001",
  slug: "synthetic",
  legal_name: "Rede sintética",
  cnpj: "ABCDEFGHIJKL00",
  plan_id: "00000000-0000-7000-8000-000000000002",
  plan_name: "Plano sintético",
  status: "trial",
  provision_status: "queued",
  schema_version: 0,
  generation: 1,
};
for (const provision_status of ["queued", "preparing", "failed"] as const)
  test(`setup ${provision_status} never fabricates intermediate progress or readiness`, () => {
    render(
      <NetworkSetup
        network={{ ...network, provision_status }}
        refresh={vi.fn()}
        retry={null}
      />,
    );
    const steps = screen
      .getByRole("status", { name: "Etapas da preparação" })
      .querySelectorAll("li");
    expect(steps).toHaveLength(5);
    expect(steps[1]).toHaveTextContent("Não informado");
    expect(steps[2]).toHaveTextContent("Não informado");
    expect(steps[3]).toHaveTextContent("Reservada");
    expect(steps[4]).toHaveTextContent("Previsto");
    expect(
      screen.queryByText(/Banco isolado confirmado/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Em andamento")).not.toBeInTheDocument();
  });
test("confirmed setup never enables invitations or invents dates", () => {
  render(
    <NetworkSetup
      network={{ ...network, provision_status: "ready", schema_version: 1 }}
      canWrite
      refresh={vi.fn()}
      retry={null}
    />,
  );
  expect(screen.getByText("Banco isolado confirmado · versão 1")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Convidar administrador" }),
  ).toBeDisabled();
  expect(screen.getByText("Não disponível")).toBeVisible();
});
test("network status is not relabeled as subscription status and support cannot edit", () => {
  render(
    <NetworkDetail
      network={{ ...network, status: "suspended" }}
      canWrite={false}
      route="/tenants/synthetic?aba=assinatura"
      navigate={vi.fn()}
    />,
  );
  expect(screen.getByText("Rede: Suspensa")).toBeVisible();
  expect(
    screen.getByText("Situação da assinatura ainda não disponibilizada."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Trocar plano" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Cancelar rede/ }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("Não disponível").length).toBeGreaterThan(0);
  expect(
    screen.getByRole("tab", { name: "Assinatura e plano" }),
  ).toHaveAttribute("aria-selected", "true");
});
