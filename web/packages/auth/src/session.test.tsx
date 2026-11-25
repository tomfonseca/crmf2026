import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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
    mfa: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <AuthPortal client={client} title="QG CRMF">
      <p>Private data</p>
    </AuthPortal>,
  );
  await screen.findByText("Private data");
  fireEvent.focus(window);
  await screen.findByLabelText("Senha");
  expect(screen.queryByText("Private data")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Sua sessão expirou");
});

test("duplicate submit is blocked and unmount cancels pending transport", async () => {
  const login = vi
    .fn<AuthClient["login"]>()
    .mockReturnValue(new Promise(() => {}));
  const client: AuthClient = {
    identity: vi.fn().mockResolvedValue(null),
    login,
    mfa: vi.fn(),
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
