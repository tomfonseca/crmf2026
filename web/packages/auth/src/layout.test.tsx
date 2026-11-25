import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthPortal } from "./AuthPortal";
import { type AuthClient, type Identity } from "./client";
import { authPreviewCases } from "./preview-cases";
afterEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
});
function client(): AuthClient {
  return {
    realm: "platform",
    identity: vi.fn().mockResolvedValue(null),
    login: vi.fn(),
    passkey: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}
test("login validates fields, focuses first error and hides secrets from storage", async () => {
  const backend = client();
  render(<AuthPortal client={backend} title="QG CRMF" />);
  const submit = await screen.findByRole("button", {
    name: "Entrar",
  });
  fireEvent.click(submit);
  fireEvent.submit(submit.closest("form")!);
  expect(screen.getByText("Informe o e-mail.")).toBeInTheDocument();
  expect(screen.getByLabelText("E-mail")).toHaveFocus();
  expect(screen.getByLabelText("Senha")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(backend.login).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Senha"), {
    target: { value: "synthetic-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
  expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Usar tema escuro" }));
  expect(Object.entries(localStorage)).toEqual([["crmf.auth.theme", "dark"]]);
  expect(sessionStorage.length).toBe(0);
});
test("forgot password cannot report success or submit until real backend exists", async () => {
  const backend = client();
  render(<AuthPortal client={backend} title="QG CRMF" />);
  fireEvent.click(
    await screen.findByRole("link", { name: "Esqueci minha senha" }),
  );
  expect(
    screen.getByRole("heading", { name: "Esqueci minha senha" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Enviar link de redefinição" }),
  ).toBeDisabled();
  expect(
    screen.queryByText(/você receberá as instruções/),
  ).not.toBeInTheDocument();
  expect(backend.login).not.toHaveBeenCalled();
});
test("incoming reset token is discarded, never treated as a validated identity", async () => {
  window.history.replaceState(
    null,
    "",
    "/nova-senha?token=synthetic-sensitive-token#not-a-session",
  );
  const backend = client();
  render(<AuthPortal client={backend} title="QG CRMF" />);
  expect(
    await screen.findByRole("heading", { name: "Criar nova senha" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(window.location.search + window.location.hash).toBe(""),
  );
  expect(screen.getByRole("button", { name: "Salvar senha" })).toBeDisabled();
  expect(localStorage.length).toBe(0);
});
test("account renders only server identity and keeps unsupported mutations disabled", async () => {
  const backend = client();
  const identity: Identity = {
    realm: "platform",
    user_id: "00000000-0000-7000-8000-000000000001",
    store_ids: [],
    grants: [{ role: "platform_admin" }],
  };
  vi.mocked(backend.identity).mockResolvedValue(identity);
  render(<AuthPortal client={backend} title="QG CRMF" />);
  fireEvent.click(await screen.findByRole("button", { name: "Minha conta" }));
  expect(
    screen.getByRole("heading", { name: "Minha conta" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Pessoa de demonstração")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Perfil" }), {
    key: "End",
  });
  expect(
    screen.getByRole("tab", { name: "Segurança e passkeys" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("button", { name: "Adicionar outra chave" }),
  ).toBeDisabled();
  expect(backend.passkey).not.toHaveBeenCalled();
});
test("reference inventory covers every supplied variant without importing HTML", () => {
  expect(authPreviewCases).toHaveLength(94);
  expect(new Set(authPreviewCases).size).toBe(94);
  for (const file of authPreviewCases)
    expect(file).toMatch(/^[A-Za-z0-9-]+\.html$/);
});
