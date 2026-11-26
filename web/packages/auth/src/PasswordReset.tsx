import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import {
  AuthFailure,
  authMessage,
  type AuthClient,
  type Realm,
} from "./client";
import { Banner, PasswordField, PasswordRules } from "./layout";

export function PasswordReset({
  realm,
  reset,
  onAttempt,
  onLogin,
}: {
  realm: Realm;
  reset: NonNullable<AuthClient["resetPassword"]>;
  onAttempt: () => void;
  onLogin: () => void;
}) {
  const proof = useRef("");
  const boundRealm = useRef(realm);
  const captured = useRef(false);
  const life = useRef(false);
  const locked = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [view, setView] = useState<
    "invalid" | "form" | "success" | "uncertain"
  >("invalid");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("");
  const [error, setError] = useState("");

  // Layout precedes AuthPortal's generic URL scrub. Capture once into a ref,
  // not an impure state initializer (which StrictMode evaluates twice).
  useLayoutEffect(() => {
    life.current = true;
    if (boundRealm.current !== realm) {
      proof.current = "";
      setView(locked.current ? "uncertain" : "invalid");
      locked.current = false;
      setBusy(false);
      setNext("");
      form.current?.reset();
      boundRealm.current = realm;
    }
    if (!captured.current) {
      captured.current = true;
      const path = realm === "platform" ? "/nova-senha" : "/login/nova-senha";
      const match = /^#token=([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(
        window.location.hash,
      );
      if (
        window.location.pathname === path &&
        !window.location.search &&
        match
      ) {
        proof.current = match[1];
        setView("form");
      }
      if (window.location.search || window.location.hash)
        window.history.replaceState(null, "", window.location.pathname);
    }
    const leave = () => {
      const wasPending = locked.current;
      proof.current = "";
      pending.current?.abort();
      locked.current = false;
      form.current?.reset();
      setNext("");
      setBusy(false);
      setView(wasPending ? "uncertain" : "invalid");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      life.current = false;
      pending.current?.abort();
      window.removeEventListener("pagehide", leave);
      // StrictMode's simulated cleanup/setup is synchronous; actual unmount
      // releases the secret without breaking its immediate development replay.
      queueMicrotask(() => {
        if (!life.current) proof.current = "";
      });
    };
  }, [realm]);
  useLayoutEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        locked.current ||
        next ||
        (form.current?.elements.namedItem("confirmation") instanceof
          HTMLInputElement &&
          (form.current.elements.namedItem("confirmation") as HTMLInputElement)
            .value)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [next]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !proof.current || view !== "form") return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    if (
      Array.from(password).length < 12 ||
      new TextEncoder().encode(password).length > 1024
    ) {
      setError("Use pelo menos 12 caracteres e até 1024 bytes.");
      return;
    }
    const token = proof.current;
    proof.current = "";
    locked.current = true;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setNext("");
    form.current?.reset();
    onAttempt();
    try {
      await reset(token, password, controller.signal);
      if (life.current && !controller.signal.aborted) setView("success");
    } catch (failure) {
      if (!life.current || controller.signal.aborted) return;
      if (
        failure instanceof AuthFailure &&
        failure.status === 400 &&
        failure.kind === "password_policy"
      ) {
        proof.current = token;
        setError(
          "Escolha uma senha diferente, fora da lista de senhas comuns.",
        );
      } else if (failure instanceof AuthFailure && failure.status === 429) {
        proof.current = token;
        setError(authMessage(failure));
      } else if (
        failure instanceof AuthFailure &&
        failure.status === 400 &&
        failure.kind === "reset_token_invalid"
      ) {
        setView("invalid");
      } else {
        // Failure/timeout may follow commit. No retry with this proof.
        setView("uncertain");
      }
    } finally {
      if (life.current && !controller.signal.aborted) {
        locked.current = false;
        setBusy(false);
      }
    }
  }

  if (view !== "form")
    return (
      <>
        <h1 id="auth-title">
          {view === "success"
            ? "Senha redefinida"
            : view === "uncertain"
              ? "Não foi possível confirmar a redefinição"
              : "Link indisponível"}
        </h1>
        <Banner tone={view === "success" ? "ok" : "warn"}>
          {view === "success"
            ? "Todas as sessões foram encerradas. Entre com sua nova senha e a mesma passkey, quando exigida."
            : view === "uncertain"
              ? "A operação pode ter sido concluída. Não a repetimos. Volte ao login e confira sua nova senha antes de solicitar outro link."
              : "Este link é inválido, já foi usado ou expirou. Solicite um novo link para continuar."}
        </Banner>
        <button className="auth-secondary" onClick={onLogin}>
          Ir para o login
        </button>
      </>
    );
  return (
    <>
      <h1 id="auth-title">Criar nova senha</h1>
      <p className="auth-subtitle">
        Use uma senha forte e diferente das anteriores. Suas passkeys serão
        preservadas.
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <form ref={form} onSubmit={(event) => void submit(event)}>
        <PasswordField
          label="Nova senha"
          name="password"
          autoComplete="new-password"
          required
          disabled={busy}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <PasswordRules password={next} />
        <PasswordField
          label="Confirmar nova senha"
          name="confirmation"
          autoComplete="new-password"
          required
          disabled={busy}
        />
        <button className="auth-primary" type="submit" disabled={busy}>
          {busy ? "Redefinindo…" : "Redefinir senha"}
        </button>
      </form>
      <button
        className="auth-link auth-cancel"
        disabled={busy}
        onClick={onLogin}
      >
        Voltar para o login
      </button>
    </>
  );
}
