import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AccountSecurity } from "./AccountSecurity";
import { AuthFailure, type OwnSession } from "./client";
const session: OwnSession = {
  id: "00000000-0000-7000-8000-000000000001",
  current: true,
  created_at: "2026-01-01T10:00:00Z",
  last_seen_at: "2026-01-01T11:00:00Z",
  idle_expires_at: "2026-01-01T12:00:00Z",
  expires_at: "2026-01-02T12:00:00Z",
  mfa_verified: true,
};
function fixture() {
  return {
    sessions: vi.fn().mockResolvedValue({ items: [session] }),
    endSession: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
  };
}
function fill() {
  for (const [label, value] of [
    ["Senha atual", "Original disposable passphrase"],
    ["Nova senha", "New disposable passphrase"],
    ["Confirmar nova senha", "New disposable passphrase"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
test("password confirms policy and clears secret fields without storage", async () => {
  const client = fixture(),
    ended = vi.fn(),
    busy = vi.fn();
  render(
    <AccountSecurity
      client={client}
      mode="password"
      onEnded={ended}
      onBusy={busy}
    />,
  );
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Salvar senha" }));
  await waitFor(() =>
    expect(ended).toHaveBeenCalledWith(
      expect.stringContaining("Senha alterada"),
    ),
  );
  expect(client.changePassword).toHaveBeenCalledTimes(1);
  expect(client.changePassword.mock.calls[0].slice(0, 2)).toEqual([
    "Original disposable passphrase",
    "New disposable passphrase",
  ]);
  expect(screen.getByLabelText("Senha atual")).toHaveValue("");
  expect(screen.getByLabelText("Nova senha")).toHaveValue("");
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
    "disposable",
  );
});
test("wrong password retains valid session; uncertain write prevents automatic repetition", async () => {
  const client = fixture(),
    ended = vi.fn();
  client.changePassword
    .mockRejectedValueOnce(new AuthFailure(400, "current_password_invalid"))
    .mockRejectedValueOnce(new AuthFailure(0));
  render(
    <AccountSecurity
      client={client}
      mode="password"
      onEnded={ended}
      onBusy={() => {}}
    />,
  );
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Salvar senha" }));
  expect(
    await screen.findByText("Não foi possível confirmar a senha atual."),
  ).toBeInTheDocument();
  expect(ended).not.toHaveBeenCalled();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Salvar senha" }));
  await screen.findByText(/Não foi possível confirmar a operação/);
  expect(screen.getByRole("button", { name: "Salvar senha" })).toBeDisabled();
  expect(client.changePassword).toHaveBeenCalledTimes(2);
});
test("sessions load is StrictMode owned, explicit and aborts on leave", async () => {
  const client = fixture();
  const { unmount } = render(
    <StrictMode>
      <AccountSecurity
        client={client}
        mode="sessions"
        onEnded={() => {}}
        onBusy={() => {}}
      />
    </StrictMode>,
  );
  await screen.findByText("Esta sessão");
  expect(client.endSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Atualizar sessões" }));
  await screen.findByText("Esta sessão");
  const call = client.sessions.mock.calls.at(-1);
  unmount();
  expect(call?.[1].aborted).toBe(true);
});
test("unavailable sessions do not appear empty and 401 ends local scope", async () => {
  const client = fixture(),
    ended = vi.fn();
  client.sessions
    .mockRejectedValueOnce(new AuthFailure(503))
    .mockRejectedValueOnce(new AuthFailure(401));
  render(
    <AccountSecurity
      client={client}
      mode="sessions"
      onEnded={ended}
      onBusy={() => {}}
    />,
  );
  await screen.findByText("Dados de sessões indisponíveis.");
  expect(screen.queryByText(/Nenhuma sessão ativa/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Atualizar sessões" }));
  await waitFor(() =>
    expect(ended).toHaveBeenCalledWith(
      expect.stringContaining("Sua sessão terminou"),
    ),
  );
});
test("late password success after unmount cannot change account state", async () => {
  const client = fixture(),
    ended = vi.fn();
  let done: () => void = () => {};
  client.changePassword.mockImplementation(
    () =>
      new Promise<void>((r) => {
        done = r;
      }),
  );
  const { unmount } = render(
    <AccountSecurity
      client={client}
      mode="password"
      onEnded={ended}
      onBusy={() => {}}
    />,
  );
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Salvar senha" }));
  unmount();
  done();
  await Promise.resolve();
  expect(ended).not.toHaveBeenCalled();
});
