import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  authMessage,
  enrollmentSecret,
  type AuthClient,
  type Identity,
  type Outcome,
} from "./client";
import "@crmf/ui/styles.css";
import "./auth.css";

type State =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "unavailable" }
  | { kind: "mfa"; uri?: string }
  | { kind: "recovery"; codes: string[] }
  | { kind: "ready"; identity: Identity };
const ScopeContext = createContext<Identity | null>(null);
export function useScope(): Identity {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("Authenticated scope unavailable");
  return scope;
}

export function AuthPortal({
  client,
  title,
  children,
}: {
  client: AuthClient;
  title: string;
  children?: ReactNode;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const active = useRef(true);
  const locked = useRef(false);

  async function restore(signal: AbortSignal) {
    const identity = await client.identity(signal);
    if (!signal.aborted && active.current)
      setState(identity ? { kind: "ready", identity } : { kind: "login" });
  }
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    pending.current = controller;
    void restore(controller.signal).catch((failure) => {
      if (!controller.signal.aborted && active.current) {
        setState({ kind: "unavailable" });
        setError(authMessage(failure));
      }
    });
    return () => {
      active.current = false;
      controller.abort();
      pending.current?.abort();
    };
  }, [client]);
  useEffect(() => {
    if (state.kind !== "mfa") return;
    const timer = window.setTimeout(() => {
      pending.current?.abort();
      locked.current = false;
      setBusy(false);
      setState({ kind: "login" });
      setError("O desafio expirou. Entre novamente.");
    }, 5 * 60_000);
    return () => window.clearTimeout(timer);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    function refreshOnFocus() {
      if (locked.current) return;
      void perform(async (signal) => {
        try {
          const identity = await client.identity(signal);
          if (signal.aborted || !active.current) return;
          setState(identity ? { kind: "ready", identity } : { kind: "login" });
          if (!identity) setError("Sua sessão expirou. Entre novamente.");
        } catch (failure) {
          if (!signal.aborted && active.current)
            setState({ kind: "unavailable" });
          throw failure;
        }
      });
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [state.kind, client]);

  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted && active.current)
        setError(authMessage(failure));
    } finally {
      if (!controller.signal.aborted && active.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function accept(outcome: Outcome, signal: AbortSignal) {
    if (signal.aborted || !active.current) return;
    switch (outcome.status) {
      case "enrollment_required":
        enrollmentSecret(outcome.enrollment_uri);
        setState({ kind: "mfa", uri: outcome.enrollment_uri });
        break;
      case "mfa_required":
        setState({ kind: "mfa" });
        break;
      case "authenticated":
        if (outcome.recovery_codes?.length)
          setState({ kind: "recovery", codes: outcome.recovery_codes });
        else await restore(signal);
        break;
    }
  }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get("email") ?? "");
    const password = String(values.get("password") ?? "");
    form.reset();
    void perform(async (signal) =>
      accept(await client.login(email, password, signal), signal),
    );
  }
  function mfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").trim();
    form.reset();
    void perform(async (signal) =>
      accept(await client.mfa(code, signal), signal),
    );
  }
  function signOut() {
    void perform(async (signal) => {
      await client.logout(signal);
      if (!signal.aborted && active.current) setState({ kind: "login" });
    });
  }

  return (
    <main className="dashboard auth-page">
      <section
        className="auth-card"
        aria-labelledby="auth-title"
        aria-busy={busy}
      >
        <h1 id="auth-title">{title}</h1>
        {error && <p role="alert">{error}</p>}
        {state.kind === "loading" && <p role="status">Verificando sessão…</p>}
        {state.kind === "unavailable" && (
          <>
            <p>
              Não foi possível verificar sua sessão. Nenhum acesso de
              demonstração foi concedido.
            </p>
            <button
              disabled={busy}
              onClick={() => void perform(async (signal) => restore(signal))}
            >
              Tentar novamente
            </button>
          </>
        )}
        {state.kind === "login" && (
          <form onSubmit={login}>
            <h2>Entrar</h2>
            <label>
              E-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                maxLength={320}
                required
                disabled={busy}
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
            <p>
              O acesso é criado por um administrador. Não há cadastro público.
            </p>
          </form>
        )}
        {state.kind === "mfa" && (
          <>
            <h2>
              {state.uri
                ? "Configurar autenticação em duas etapas"
                : "Verificação em duas etapas"}
            </h2>
            {state.uri && (
              <div>
                <p>
                  Adicione uma conta TOTP manualmente no seu autenticador, com
                  esta chave. Use 6 dígitos, SHA-1 e período de 30 segundos.
                </p>
                <code
                  className="auth-secret"
                  aria-label="Chave do autenticador"
                >
                  {enrollmentSecret(state.uri)}
                </code>
                <p>Esta chave é secreta. Não a envie ao suporte.</p>
              </div>
            )}
            <form onSubmit={mfa}>
              <label>
                {state.uri
                  ? "Código do autenticador"
                  : "Código do autenticador ou de recuperação"}
                <input
                  name="code"
                  autoComplete="one-time-code"
                  minLength={6}
                  maxLength={32}
                  required
                  disabled={busy}
                />
              </label>
              <button type="submit" disabled={busy}>
                Verificar código
              </button>
            </form>
            <button
              className="auth-secondary"
              disabled={busy}
              onClick={signOut}
            >
              Cancelar e voltar
            </button>
          </>
        )}
        {state.kind === "recovery" && (
          <>
            <h2>Guarde seus códigos de recuperação</h2>
            <p>
              Eles aparecem apenas nesta etapa. Cada código pode ser usado uma
              vez. Guarde-os em um local seguro antes de continuar.
            </p>
            <ul className="auth-codes">
              {state.codes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
            <button
              disabled={busy}
              onClick={() => {
                setState({ kind: "loading" });
                void perform(async (signal) => {
                  try {
                    await restore(signal);
                  } catch (failure) {
                    if (!signal.aborted && active.current)
                      setState({ kind: "unavailable" });
                    throw failure;
                  }
                });
              }}
            >
              Guardei os códigos
            </button>
          </>
        )}
        {state.kind === "ready" && (
          <ScopeContext.Provider value={state.identity}>
            <p role="status">Sessão autenticada.</p>
            {children ?? (
              <p>Os módulos operacionais ainda estão em implementação.</p>
            )}
            <button disabled={busy} onClick={signOut}>
              Sair
            </button>
          </ScopeContext.Provider>
        )}
      </section>
    </main>
  );
}
