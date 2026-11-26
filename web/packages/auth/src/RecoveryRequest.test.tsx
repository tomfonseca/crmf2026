import { StrictMode } from "react";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { expect, test, vi, afterEach } from "vitest";
import { RecoveryRequest } from "./RecoveryRequest";
import { createAuthClient } from "./client";

afterEach(() => vi.unstubAllGlobals());
function mount(request = vi.fn().mockResolvedValue(undefined)) {
  const onLogin = vi.fn();
  return {
    ...render(
      <StrictMode>
        <RecoveryRequest realm="tenant" request={request} onLogin={onLogin} />
      </StrictMode>,
    ),
    request,
    onLogin,
  };
}
function submit() {
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "disposable@example.invalid" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Enviar instruções" }).closest("form")!,
  );
}
test("request accepts only 202 as acknowledgement, no account/delivery assertion or storage", async () => {
  const { request } = mount();
  submit();
  await screen.findByRole("heading", { name: "Solicitação recebida" });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "disposable@example.invalid",
    expect.any(AbortSignal),
  );
  expect(screen.getByText(/não confirma a existência/)).toBeInTheDocument();
  expect(screen.queryByLabelText("E-mail")).toBeNull();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
test("request clears DOM, blocks duplicates and does not retry an uncertain write", async () => {
  let reject!: (e: Error) => void;
  const request = vi.fn(
    () =>
      new Promise<void>((_, r) => {
        reject = r;
      }),
  );
  mount(request);
  submit();
  expect(screen.getByLabelText("E-mail")).toHaveValue("");
  fireEvent.submit(
    screen.getByRole("button", { name: "Registrando…" }).closest("form")!,
  );
  expect(request).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("transport unknown")));
  await screen.findByRole("heading", { name: "Resultado não confirmado" });
  expect(
    screen.queryByRole("button", { name: "Enviar instruções" }),
  ).toBeNull();
  expect(request).toHaveBeenCalledOnce();
});
test("pagehide aborts transport and shows uncertainty rather than rollback", async () => {
  const request = vi.fn((_e: string, _s?: AbortSignal) => {
    void _e;
    void _s;
    return new Promise<void>(() => {});
  });
  mount(request);
  submit();
  fireEvent(window, new Event("pagehide"));
  expect(request.mock.calls[0][1]?.aborted).toBe(true);
  await screen.findByRole("heading", { name: "Resultado não confirmado" });
});
test("unmount aborts and a late receipt cannot restore the view", async () => {
  let finish!: () => void;
  const request = vi.fn((_e: string, _s?: AbortSignal) => {
    void _e;
    void _s;
    return new Promise<void>((r) => {
      finish = r;
    });
  });
  const { unmount } = mount(request);
  submit();
  unmount();
  expect(request.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => finish());
  expect(
    screen.queryByRole("heading", { name: "Solicitação recebida" }),
  ).toBeNull();
});
test.each(["tenant", "platform"] as const)(
  "client %s uses strict realm and rejects other successful status",
  async (realm) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const client = createAuthClient("https://api.example.test", realm);
    await client.requestRecovery!("disposable@example.invalid");
    const req = fetch.mock.calls[0][0] as Request;
    expect(req.url).toBe(
      "https://api.example.test/v1/" +
        (realm === "platform" ? "hq/" : "") +
        "auth/password/forgot",
    );
    expect(req.headers.get("X-CRMF-Request")).toBe("1");
    expect(req.cache).toBe("no-store");
    expect(await req.json()).toEqual({ email: "disposable@example.invalid" });
    await expect(
      client.requestRecovery!("disposable@example.invalid"),
    ).rejects.toMatchObject({ status: 204 });
  },
);
