import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { AuthClient, Realm } from "./client";
import { Banner } from "./layout";

export function RecoveryRequest({
  request,
  realm,
  onLogin,
}: {
  request: NonNullable<AuthClient["requestRecovery"]>;
  realm: Realm;
  onLogin: () => void;
}) {
  const active = useRef(false);
  const locked = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<"form" | "accepted" | "uncertain">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [view]);
  useLayoutEffect(() => {
    active.current = true;
    if (window.location.search || window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
    const leave = () => {
      form.current?.reset();
      if (locked.current) {
        locked.current = false;
        pending.current?.abort();
        setBusy(false);
        setView("uncertain");
      }
    };
    window.addEventListener("pagehide", leave);
    return () => {
      active.current = false;
      pending.current?.abort();
      window.removeEventListener("pagehide", leave);
    };
  }, [realm]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || view !== "form") return;
    const field = form.current?.elements.namedItem("email") as HTMLInputElement;
    if (!field?.validity.valid || !field.value.trim()) {
      setError("Informe um e-mail válido.");
      field?.focus();
      return;
    }
    const email = field.value;
    form.current?.reset();
    setError("");
    setBusy(true);
    locked.current = true;
    const controller = new AbortController();
    pending.current = controller;
    try {
      await request(email, controller.signal);
      if (active.current && !controller.signal.aborted) setView("accepted");
    } catch {
      if (active.current && !controller.signal.aborted) setView("uncertain");
    } finally {
      if (active.current && !controller.signal.aborted) {
        setBusy(false);
        locked.current = false;
      }
    }
  }
  return (
    <>
      <h1 id="auth-title" ref={heading} tabIndex={-1}>
        {view === "accepted"
          ? "Solicitação recebida"
          : view === "uncertain"
            ? "Resultado não confirmado"
            : "Esqueci minha senha"}
      </h1>
      <p className="auth-subtitle">
        {view === "accepted"
          ? "Se houver uma conta elegível, e os limites permitirem, você receberá instruções. Isso não confirma a existência da conta nem o envio de e-mail."
          : view === "uncertain"
            ? "A solicitação pode ter sido registrada. Verifique seu e-mail antes de fazer outro pedido; não repetimos automaticamente."
            : "Informe o e-mail da sua conta. O link de recuperação não remove sua passkey."}
      </p>
      {window.location.hostname === "localhost" && (
        <p className="auth-subtitle">
          Captura local: use somente contas descartáveis UUID@example.invalid.
          Não use a conta real do operador.
        </p>
      )}
      {view === "form" && (
        <form ref={form} onSubmit={submit} noValidate aria-busy={busy}>
          <div className="auth-field">
            <label htmlFor="recovery-email">E-mail</label>
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
              disabled={busy}
            />
          </div>
          {error && <Banner>{error}</Banner>}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? "Registrando…" : "Enviar instruções"}
          </button>
        </form>
      )}
      <button
        className="auth-link auth-cancel"
        type="button"
        disabled={busy}
        onClick={onLogin}
      >
        Voltar para entrar
      </button>
    </>
  );
}
