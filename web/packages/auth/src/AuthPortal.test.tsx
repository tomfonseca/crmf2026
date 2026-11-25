import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthPortal, useScope } from "./AuthPortal";
import { AuthFailure, type AuthClient, type Identity } from "./client";
import { provePasskey, PasskeyFailure } from "./passkey";
vi.mock("./passkey", async (original) => ({
  ...(await original<typeof import("./passkey")>()),
  provePasskey: vi
    .fn()
    .mockResolvedValue('{"type":"public-key","synthetic":true}'),
}));
const enrollment = {
  status: "enrollment_required" as const,
  public_key: JSON.stringify({
    challenge: "a".repeat(43),
    rp: { id: "localhost" },
    user: { id: "synthetic-user" },
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  }),
};
const assertion = {
  status: "passkey_required" as const,
  public_key: JSON.stringify({
    challenge: "a".repeat(43),
    rpId: "localhost",
    userVerification: "required",
    allowCredentials: [{ type: "public-key", id: "synthetic-credential" }],
  }),
};

const identity: Identity = {
  user_id: "00000000-0000-7000-8000-000000000001",
  realm: "platform",
  store_ids: [],
  grants: [{ role: "platform_admin" }],
};
function fixture() {
  return {
    identity: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue({ status: "authenticated" }),
    passkey: vi.fn().mockResolvedValue({ status: "authenticated" }),
    logout: vi.fn().mockResolvedValue(undefined),
  } satisfies AuthClient;
}
function submitLogin() {
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "fixture@example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("Senha"), {
    target: { value: "synthetic-password-only" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Entrar" }).closest("form")!,
  );
}
afterEach(() => vi.restoreAllMocks());

test("login clears password, requires MFA and presents recovery codes once without storage", async () => {
  const client = fixture();
  client.login.mockResolvedValue(enrollment);
  const codes = Array.from({ length: 10 }, (_, i) =>
    i.toString(16).padStart(32, "0"),
  );
  client.passkey.mockResolvedValue({
    status: "authenticated",
    recovery_codes: codes,
  });
  const storage = vi.spyOn(Storage.prototype, "setItem");
  render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByLabelText("Senha");
  submitLogin();
  await screen.findByText("Cadastrar passkey");
  expect(
    screen.queryByDisplayValue("synthetic-password-only"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Sessão autenticada.")).not.toBeInTheDocument();
  expect(client.passkey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Criar passkey" }));
  await screen.findByText("Guarde seus códigos de recuperação");
  expect(screen.queryByText("Cadastrar passkey")).not.toBeInTheDocument();
  expect(screen.queryByText("Sessão autenticada.")).not.toBeInTheDocument();
  client.identity.mockResolvedValue(identity);
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Guardei os códigos/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByText("Sessão autenticada.");
  expect(screen.queryByText(codes[0])).not.toBeInTheDocument();
  expect(storage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sair" }));
  await screen.findByRole("button", { name: "Entrar" });
  expect(client.logout).toHaveBeenCalledOnce();
});

test("API outage fails closed and retries; no anonymous dashboard", async () => {
  const client = fixture();
  client.identity.mockRejectedValueOnce(new AuthFailure(503));
  render(
    <AuthPortal client={client} title="QG CRMF">
      <p>Private data</p>
    </AuthPortal>,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Private data")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Entrar" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByLabelText("Senha");
});

test("expired passkey does not unlock access and recovery input is cleared", async () => {
  const client = fixture();
  client.login.mockResolvedValue(assertion);
  client.passkey.mockRejectedValue(new AuthFailure(401));
  render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByLabelText("Senha");
  submitLogin();
  fireEvent.click(await screen.findByText("Usar um código de recuperação"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar com código" }));
  const input = await screen.findByLabelText("Código de recuperação");
  fireEvent.change(input, { target: { value: "a".repeat(32) } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByRole("alert");
  expect(input).toHaveValue("");
  expect(screen.queryByText("Sessão autenticada.")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Voltar para a passkey" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancelar e voltar" }));
  await screen.findByLabelText("Senha");
});

test("cancelling the native passkey prompt never submits a proof or grants access", async () => {
  const client = fixture();
  client.login.mockResolvedValue(enrollment);
  vi.mocked(provePasskey).mockRejectedValueOnce(
    new PasskeyFailure("Verificação cancelada."),
  );
  render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByLabelText("Senha");
  submitLogin();
  fireEvent.click(await screen.findByRole("button", { name: "Criar passkey" }));
  await screen.findByRole("alert");
  expect(client.passkey).not.toHaveBeenCalled();
  expect(screen.queryByText("Sessão autenticada.")).not.toBeInTheDocument();
});

test("native cancellation aborts locally and revokes the backend challenge", async () => {
  const client = fixture();
  client.login.mockResolvedValue(enrollment);
  vi.mocked(provePasskey).mockImplementationOnce(
    (_, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new PasskeyFailure("Verificação cancelada.")),
          { once: true },
        ),
      ),
  );
  render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByLabelText("Senha");
  submitLogin();
  fireEvent.click(await screen.findByRole("button", { name: "Criar passkey" }));
  expect(
    screen.queryByText("Usar um código de recuperação"),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  await screen.findByLabelText("Senha");
  expect(client.logout).toHaveBeenCalledOnce();
  expect(client.passkey).not.toHaveBeenCalled();
});
test("submitted proof cannot race cancellation or grant access before identity", async () => {
  const client = fixture();
  client.login.mockResolvedValue(enrollment);
  let finish!: (outcome: { status: "authenticated" }) => void;
  client.passkey.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByLabelText("Senha");
  submitLogin();
  fireEvent.click(await screen.findByRole("button", { name: "Criar passkey" }));
  await waitFor(() => expect(client.passkey).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  expect(screen.queryByText("Sessão autenticada.")).not.toBeInTheDocument();
  finish({ status: "authenticated" });
  await screen.findByLabelText("Senha");
  expect(client.logout).not.toHaveBeenCalled();
});

test("logout failure is not presented as success", async () => {
  const client = fixture();
  client.identity.mockResolvedValue(identity);
  client.logout.mockRejectedValue(new AuthFailure(503));
  render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByRole("button", { name: "Sair" });
  fireEvent.click(screen.getByRole("button", { name: "Sair" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: "Entrar" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sair" })).toBeEnabled();
});

test("useScope only reaches authenticated children", async () => {
  function Private() {
    const scope = useScope();
    return <p>{scope.realm}</p>;
  }
  const client = fixture();
  client.identity.mockResolvedValue(identity);
  render(
    <AuthPortal client={client} title="QG CRMF">
      <Private />
    </AuthPortal>,
  );
  await screen.findByText("platform");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sair" })).toBeEnabled(),
  );
});
