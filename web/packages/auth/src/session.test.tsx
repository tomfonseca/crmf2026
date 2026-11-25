import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { AuthPortal } from "./AuthPortal";
import { type AuthClient, type Identity } from "./client";

const identity: Identity = {
  user_id: "00000000-0000-7000-8000-000000000001",
  realm: "platform",
  store_ids: [],
  grants: [{ role: "platform_admin" }],
};

test("focus rechecks expiration without background idle keepalive", async () => {
  const client: AuthClient = {
    identity: vi
      .fn<AuthClient["identity"]>()
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(null),
    login: vi.fn(),
    passkey: vi.fn(),
    logout: vi.fn(),
  };
  const focusListener = vi.spyOn(window, "addEventListener");
  render(
    <AuthPortal client={client} title="QG CRMF">
      <p>Private data</p>
    </AuthPortal>,
  );
  await screen.findByText("Private data");
  expect(focusListener).toHaveBeenCalledWith("focus", expect.any(Function));
  fireEvent.focus(window);
  expect(client.identity).toHaveBeenCalledTimes(2);
  await screen.findByRole("heading", { name: "Sua sessão expirou" });
  expect(screen.queryByText("Private data")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Sua sessão expirou");
  fireEvent.focus(window);
  expect(client.identity).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Entrar novamente" }));
  await screen.findByLabelText("Senha");
});

test("duplicate submit is blocked and unmount cancels pending transport", async () => {
  const login = vi
    .fn<AuthClient["login"]>()
    .mockReturnValue(new Promise(() => {}));
  const client: AuthClient = {
    identity: vi.fn().mockResolvedValue(null),
    login,
    passkey: vi.fn(),
    logout: vi.fn(),
  };
  const view = render(<AuthPortal client={client} title="QG CRMF" />);
  await screen.findByLabelText("Senha");
  const form = screen.getByRole("button", { name: "Entrar" }).closest("form")!;
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "fixture@example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("Senha"), {
    target: { value: "synthetic-password-only" },
  });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(login).toHaveBeenCalledOnce();
  const signal = login.mock.calls[0][2];
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
