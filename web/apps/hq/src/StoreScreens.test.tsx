import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StoreScreens, type StoreRecord } from "./StoreScreens";
const configuredStore: StoreRecord = {
  id: "00000000-0000-7000-8000-000000000001",
  networkId: "00000000-0000-7000-8000-000000000002",
  networkSlug: "synthetic",
  networkName: "Rede sintética",
  code: "S001",
  name: "Loja sintética",
  city: "",
  uf: "",
  timezone: "America/Sao_Paulo",
  active: true,
  version: 1,
};
test("known store configuration does not manufacture health, unpaired device or empty batches", () => {
  render(
    <StoreScreens
      route={`/stores/${configuredStore.id}`}
      records={[configuredStore]}
      connected
      navigate={vi.fn()}
      canWrite
    />,
  );
  for (const text of [
    "Saudável",
    "Offline",
    "Nenhum dispositivo pareado",
    "Sem dados recebidos",
    "Nenhum lote nesta prévia visual.",
  ])
    expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument();
  expect(
    screen.getByText("Consulta de lotes ainda não disponível."),
  ).toBeVisible();
});
test("editing freezes revision and clears navigation flags before success callback", async () => {
  const onSave = vi.fn().mockResolvedValue({ ...configuredStore, version: 2 });
  const onSaved = vi.fn(() => {
    const form = document.querySelector("form.stores-form");
    expect(form).toHaveAttribute("data-dirty", "false");
    expect(form).toHaveAttribute("data-saving", "false");
  });
  const props = {
    route: `/stores/${configuredStore.id}/edit`,
    navigate: vi.fn(),
    canWrite: true,
    connected: true,
    onSave,
    onSaved,
  };
  const view = render(<StoreScreens {...props} records={[configuredStore]} />);
  fireEvent.change(screen.getByLabelText("Nome", { exact: true }), {
    target: { value: "Nome editado" },
  });
  view.rerender(
    <StoreScreens
      {...props}
      records={[{ ...configuredStore, name: "Edição concorrente", version: 8 }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Salvar loja" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][1].version).toBe(1);
  expect(onSave.mock.calls[0][0].name).toBe("Nome editado");
});
import { StorePreview } from "./StorePreview";
test("missing store service is not an empty catalog, healthy integration or zero count", () => {
  render(<StoreScreens route="/stores" navigate={vi.fn()} canWrite />);
  expect(
    screen.getByText("Consulta de lojas ainda não disponível."),
  ).toBeVisible();
  expect(screen.queryByText("Nenhuma loja cadastrada")).not.toBeInTheDocument();
  expect(screen.queryByText(/0 lojas/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  expect(
    screen.queryByText("Saudável", { selector: "span" }),
  ).not.toBeInTheDocument();
});
test("unknown edit never adopts identity from the URL", () => {
  render(
    <StoreScreens
      route="/stores/not-a-verified-id/edit"
      navigate={vi.fn()}
      canWrite
    />,
  );
  expect(screen.getByLabelText("Nome", { exact: true })).toHaveValue("");
  expect(screen.getByLabelText("Fuso horário", { exact: true })).toHaveValue(
    "",
  );
  expect(screen.getByLabelText("Situação", { exact: true })).toHaveValue("");
  expect(screen.getByLabelText("Nome", { exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Salvar loja" })).toBeDisabled();
  expect(screen.queryByText("not-a-verified-id")).not.toBeInTheDocument();
});
test("unknown store never means unpaired, offline or no sales", () => {
  render(
    <StoreScreens route="/stores/unverified" navigate={vi.fn()} canWrite />,
  );
  for (const label of [
    "Saudável",
    "Offline",
    "Sem dados recebidos",
    "Nenhum dispositivo pareado",
    "Sem vendas · integração ok",
  ])
    expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument();
  expect(
    screen.getByText(/A ausência de integração não confirma/),
  ).toBeVisible();
  expect(screen.queryByText("unverified")).not.toBeInTheDocument();
});
test("support cannot fill a direct create form", () => {
  render(
    <StoreScreens route="/stores/new" navigate={vi.fn()} canWrite={false} />,
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Salvar loja" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Acesso de suporte: somente leitura.")).toBeVisible();
});
for (const [variant, label] of [
  ["situacao-offline", "Offline."],
  ["situacao-sem-vendas", "Sem vendas · integração ok."],
  ["situacao-sem-dados", "Sem dados recebidos."],
])
  test(`explicit development preview ${variant} has no operative mutation`, () => {
    render(
      <StorePreview
        base="QG-Loja"
        title="Loja de demonstração"
        variant={variant}
        support={false}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByText(label, { exact: true })).toBeVisible();
    for (const button of screen.getAllByRole("button", {
      name: /Reinstalar agente|Gerar código de pareamento/,
    }))
      expect(button).toBeDisabled();
    if (variant === "situacao-offline")
      expect(screen.getByText("há 20 min", { exact: true })).toBeVisible();
  });
test("limit warning remains an explicit development state and cannot save", () => {
  render(
    <StorePreview
      base="QG-Loja-Form"
      title="Cadastrar loja"
      variant="limite-atingido"
      support={false}
      navigate={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("nesta prévia");
  expect(screen.getByRole("button", { name: "Salvar loja" })).toBeDisabled();
});
