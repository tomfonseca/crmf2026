import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PasswordReset } from "./PasswordReset";
import { AuthPortal } from "./AuthPortal";
import {
  AuthFailure,
  createAuthClient,
  type Realm,
  type AuthClient,
  type Identity,
} from "./client";

const token = "A".repeat(43);
const password = "Disposable reset passphrase! 2026";
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
function mount(
  realm: Realm = "tenant",
  reset = vi.fn().mockResolvedValue(undefined),
) {
  const path = realm === "platform" ? "/nova-senha" : "/login/nova-senha";
  window.history.replaceState(null, "", path + "#token=" + token);
  const onAttempt = vi.fn(),
    onLogin = vi.fn();
  const rendered = render(
    <StrictMode>
      <PasswordReset
        realm={realm}
        reset={reset}
        onAttempt={onAttempt}
        onLogin={onLogin}
      />
    </StrictMode>,
  );
  return { ...rendered, reset, onAttempt, onLogin };
}
function submit(next = password, confirmation = next) {
  fireEvent.change(screen.getByLabelText("Nova senha"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
    target: { value: confirmation },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Redefinir senha" }).closest("form")!,
  );
}
test.each(["tenant", "platform"] as const)(
  "reset %s captures fragment once under StrictMode, scrubs URL and creates no session",
  async (realm) => {
    const { reset, onAttempt, onLogin } = mount(realm);
    expect(window.location.hash).toBe("");
    submit();
    await screen.findByRole("heading", { name: "Senha redefinida" });
    expect(reset).toHaveBeenCalledExactlyOnceWith(
      token,
      password,
      expect.any(AbortSignal),
    );
    expect(onAttempt).toHaveBeenCalledOnce();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ir para o login" }));
    expect(onLogin).toHaveBeenCalledOnce();
  },
);
test("reset checks confirmation/length and blocks duplicate writes while clearing password DOM", async () => {
  let finish!: () => void;
  const reset = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mount("tenant", reset);
  submit(password, "different");
  expect(reset).not.toHaveBeenCalled();
  submit("short");
  expect(reset).not.toHaveBeenCalled();
  submit();
  expect(screen.getByLabelText("Nova senha")).toHaveValue("");
  expect(screen.getByLabelText("Confirmar nova senha")).toHaveValue("");
  fireEvent.submit(
    screen.getByRole("button", { name: "Redefinindo…" }).closest("form")!,
  );
  expect(reset).toHaveBeenCalledOnce();
  await act(async () => finish());
});
test("known policy/rate rejection preserves proof, but invalid proof and unknown write cannot be retried", async () => {
  const reset = vi
    .fn()
    .mockRejectedValueOnce(new AuthFailure(400, "password_policy"))
    .mockRejectedValueOnce(new AuthFailure(429, "rate_limited"))
    .mockRejectedValueOnce(new AuthFailure(0));
  mount("tenant", reset);
  submit();
  await screen.findByText(/fora da lista/);
  submit();
  await screen.findByText(/Muitas tentativas/);
  submit();
  await screen.findByRole("heading", {
    name: "Não foi possível confirmar a redefinição",
  });
  expect(reset).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("button", { name: "Redefinir senha" })).toBeNull();
});
test("invalid token, query, duplicate/encoded fragment and wrong realm path are discarded before transport", () => {
  for (const path of [
    "/login/nova-senha?token=" + token,
    "/nova-senha#token=" + token,
    "/login/nova-senha#token=" + "B".repeat(43),
    "/login/nova-senha#token=" + token + "&token=" + token,
    "/login/nova-senha#token=%41" + token.slice(1),
  ]) {
    window.history.replaceState(null, "", path);
    const reset = vi.fn();
    const view = render(
      <PasswordReset
        realm="tenant"
        reset={reset}
        onAttempt={() => {}}
        onLogin={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Link indisponível" }),
    ).toBeVisible();
    expect(window.location.hash + window.location.search).toBe("");
    expect(reset).not.toHaveBeenCalled();
    view.unmount();
  }
});
test("changing realm discards the proof captured for the previous realm", () => {
  const view = mount();
  view.rerender(
    <StrictMode>
      <PasswordReset
        realm="platform"
        reset={view.reset}
        onAttempt={view.onAttempt}
        onLogin={view.onLogin}
      />
    </StrictMode>,
  );
  expect(
    screen.getByRole("heading", { name: "Link indisponível" }),
  ).toBeVisible();
  expect(view.reset).not.toHaveBeenCalled();
});
test("invalid proof response ends the flow without retaining editable proof", async () => {
  const reset = vi
    .fn()
    .mockRejectedValue(new AuthFailure(400, "reset_token_invalid"));
  mount("tenant", reset);
  submit();
  await screen.findByRole("heading", { name: "Link indisponível" });
  expect(reset).toHaveBeenCalledOnce();
});
test("pagehide cancels pending request without claiming rollback and returning from cache cannot resend", async () => {
  const reset = vi.fn<NonNullable<AuthClient["resetPassword"]>>(
    () => new Promise<void>(() => {}),
  );
  mount("tenant", reset);
  submit();
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(reset.mock.calls[0][2]?.aborted).toBe(true);
  expect(
    screen.getByRole("heading", {
      name: "Não foi possível confirmar a redefinição",
    }),
  ).toBeVisible();
});
test("unmount aborts request and ignores a late success", async () => {
  let finish!: () => void;
  const reset = vi.fn<NonNullable<AuthClient["resetPassword"]>>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount("tenant", reset);
  submit();
  view.unmount();
  expect(reset.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => finish());
  expect(screen.queryByText("Senha redefinida")).toBeNull();
});
test.each(["tenant", "platform"] as const)(
  "generated %s client sends proof only in body with CSRF/no-store and maps policy",
  async (realm) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "password_policy", status: 400 }), {
        status: 400,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = createAuthClient("https://api.example.invalid", realm);
    await expect(client.resetPassword!(token, password)).rejects.toMatchObject({
      status: 400,
      kind: "password_policy",
    });
    const request = fetcher.mock.calls[0][0] as Request;
    expect(request.url).toBe(
      "https://api.example.invalid/v1/" +
        (realm === "platform" ? "hq/" : "") +
        "auth/password/reset",
    );
    expect(request.headers.get("X-CRMF-Request")).toBe("1");
    expect(request.credentials).toBe("include");
    expect(request.cache).toBe("no-store");
    expect(await request.json()).toEqual({ token, new_password: password });
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
test("portal discards a late pre-reset identity and does not restore an old principal", async () => {
  let identify!: (value: Identity | null) => void;
  const client = {
    realm: "tenant" as const,
    identity: vi.fn(
      () =>
        new Promise<Identity | null>((resolve) => {
          identify = resolve;
        }),
    ),
    login: vi.fn(),
    passkey: vi.fn(),
    logout: vi.fn(),
    resetPassword: vi.fn().mockResolvedValue(undefined),
  };
  window.history.replaceState(null, "", "/login/nova-senha#token=" + token);
  render(
    <StrictMode>
      <AuthPortal client={client} title="Tenant">
        <div>private workspace</div>
      </AuthPortal>
    </StrictMode>,
  );
  expect(window.location.hash).toBe("");
  submit();
  await screen.findByRole("heading", { name: "Senha redefinida" });
  fireEvent.click(screen.getByRole("button", { name: "Ir para o login" }));
  await act(async () =>
    identify({
      user_id: "00000000-0000-7000-8000-000000000001",
      realm: "tenant",
      tenant_id: "00000000-0000-7000-8000-000000000002",
      store_ids: [],
      grants: [{ role: "network_admin" }],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible(),
  );
  expect(screen.queryByText("private workspace")).toBeNull();
});
