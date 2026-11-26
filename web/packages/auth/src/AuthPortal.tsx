import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AuthFailure,
  authMessage,
  type AuthClient,
  type Identity,
  type Outcome,
  type Realm,
} from "./client";
import {
  PasskeyFailure,
  provePasskey,
  validatePasskeyOptions,
} from "./passkey";
import {
  AuthFrame,
  Banner,
  Brand,
  ThemeButton,
  useAuthTheme,
  type Theme,
} from "./layout";
import {
  AccountScreen,
  LoginScreen,
  PasskeyScreen,
  RecoveryCodesScreen,
  RecoveryUseScreen,
  StatusScreen,
  type StaticScreen,
} from "./screens";
import { AccountSecurity } from "./AccountSecurity";
import "@crmf/ui/styles.css";
import "./auth.css";
type State =
  | {
      kind:
        | "loading"
        | "login"
        | "unavailable"
        | "expired"
        | "challenge-expired"
        | "blocked";
    }
  | { kind: "passkey"; outcome: Outcome }
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
  theme: controlledTheme,
  onThemeChange,
  realm: configuredRealm,
  renderWorkspace,
}: {
  client: AuthClient;
  title: string;
  children?: ReactNode;
  theme?: Theme;
  onThemeChange?: () => void;
  realm?: Realm;
  renderWorkspace?: (controls: {
    onAccount: () => void;
    onLogout: () => void;
    busy: boolean;
  }) => ReactNode;
}) {
  const realm = configuredRealm ?? client.realm ?? "tenant";
  const base = realm === "platform" ? "/" : "/login";
  const pathFor = (suffix: string) =>
    suffix ? (base === "/" ? "/" : base + "/") + suffix : base;
  const [path, setPath] = useState(window.location.pathname);
  const [tab, setTab] = useState(0);
  const [localTheme, toggleLocal] = useAuthTheme();
  const theme = controlledTheme ?? localTheme;
  const toggle = onThemeChange ?? toggleLocal;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [proofView, setProofView] = useState<
    "proof" | "code" | "failure" | "unsupported"
  >("proof");
  const [phase, setPhase] = useState<"browser" | "verify">("browser");
  const [blocked, setBlocked] = useState("");
  const pending = useRef<AbortController | null>(null);
  const active = useRef(true);
  const locked = useRef(false);
  const proofInFlight = useRef<AbortSignal | null>(null);
  useEffect(() => {
    if (state.kind === "ready" && !path.endsWith("/minha-conta")) return;
    const target =
      state.kind === "login" &&
      !/esqueci-senha|nova-senha|convite|link-invalido/.test(path)
        ? document.querySelector<HTMLInputElement>(
            'input[autocomplete="username"]',
          )
        : document.querySelector<HTMLElement>(".auth-app h1");
    if (target && !target.hasAttribute("disabled")) {
      if (target.tagName !== "INPUT") target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }, [state.kind, path, proofView]);
  function navigate(suffix: string) {
    const next = pathFor(suffix);
    window.history.pushState(null, "", next);
    setPath(next);
    setError("");
  }
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    // Unimplemented link flows must not retain an incoming token in the address/history.
    if (
      /\/(nova-senha|convite)\/?$/.test(window.location.pathname) &&
      (window.location.search || window.location.hash)
    )
      window.history.replaceState(null, "", window.location.pathname);
    return () => window.removeEventListener("popstate", update);
  }, []);
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
    if (state.kind !== "passkey") return;
    const timer = window.setTimeout(() => {
      pending.current?.abort();
      locked.current = false;
      setBusy(false);
      setState({ kind: "challenge-expired" });
      setError("");
    }, 300000);
    return () => window.clearTimeout(timer);
  }, [state.kind]);
  // Bind before the authenticated frame can receive focus.
  useLayoutEffect(() => {
    if (state.kind !== "ready") return;
    function refresh() {
      if (locked.current) return;
      void perform(async (signal) => {
        try {
          const identity = await client.identity(signal);
          if (signal.aborted || !active.current) return;
          setState(
            identity ? { kind: "ready", identity } : { kind: "expired" },
          );
          if (!identity) setError("Sua sessão expirou. Entre novamente.");
        } catch (failure) {
          if (!signal.aborted && active.current)
            setState({ kind: "unavailable" });
          throw failure;
        }
      });
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
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
    if (outcome.status !== "authenticated") {
      validatePasskeyOptions(outcome);
      setProofView("proof");
      setState({ kind: "passkey", outcome });
    } else if (outcome.recovery_codes?.length)
      setState({ kind: "recovery", codes: outcome.recovery_codes });
    else await restore(signal);
  }
  function login(email: string, password: string) {
    void perform(async (signal) => {
      try {
        await accept(await client.login(email, password, signal), signal);
      } catch (failure) {
        if (signal.aborted) return;
        if (failure instanceof AuthFailure) {
          if (failure.status === 401) {
            setError(
              "E-mail ou senha incorretos. Confira os dados e tente de novo.",
            );
            return;
          }
          if ([402, 403, 429].includes(failure.status)) {
            setBlocked(failure.status === 429 ? "bloqueio" : "negado");
            setState({ kind: "blocked" });
          } else setState({ kind: "unavailable" });
        }
        throw failure;
      }
    });
  }
  function proof() {
    if (state.kind !== "passkey") return;
    const outcome = state.outcome;
    void perform(async (signal) => {
      setPhase("browser");
      try {
        const response = await provePasskey(outcome, signal);
        if (signal.aborted) return;
        setPhase("verify");
        proofInFlight.current = signal;
        await accept(await client.passkey(response, signal), signal);
      } catch (failure) {
        if (!signal.aborted && active.current)
          setProofView(
            failure instanceof PasskeyFailure && failure.kind === "unsupported"
              ? "unsupported"
              : "failure",
          );
        throw failure;
      } finally {
        if (proofInFlight.current === signal) proofInFlight.current = null;
      }
    });
  }
  function recover(code: string) {
    void perform(async (signal) => {
      try {
        await accept(await client.passkey(code, signal), signal);
      } catch (failure) {
        if (failure instanceof AuthFailure && failure.status === 401) {
          setError(
            "Não foi possível validar o código. Confira os dados e tente novamente.",
          );
          return;
        }
        throw failure;
      }
    });
  }
  function signOut() {
    if (proofInFlight.current && !proofInFlight.current.aborted) return;
    pending.current?.abort();
    locked.current = false;
    setBusy(false);
    void perform(async (signal) => {
      await client.logout(signal);
      if (!signal.aborted && active.current) {
        setState({ kind: "login" });
        navigate("");
      }
    });
  }
  function goLogin() {
    if (state.kind === "passkey" || state.kind === "recovery") {
      signOut();
      return;
    }
    setState({ kind: "login" });
    setError("");
    navigate("");
  }
  const publicScreens: Record<string, StaticScreen> = {
    [pathFor("esqueci-senha")]: "forgot",
    [pathFor("nova-senha")]: "reset",
    [pathFor("convite")]: "invite",
    [pathFor("link-invalido")]: "invalid",
  };
  const publicScreen = publicScreens[path];
  const common = { realm, theme, toggle };
  if (publicScreen && state.kind !== "passkey" && state.kind !== "recovery")
    return (
      <AuthFrame {...common}>
        <StatusScreen
          screen={publicScreen}
          realm={realm}
          onLogin={state.kind === "ready" ? () => navigate("") : goLogin}
          onForgot={() => navigate("esqueci-senha")}
          onRetry={() => {}}
        />
      </AuthFrame>
    );
  if (
    state.kind === "ready" &&
    renderWorkspace &&
    !path.endsWith("/minha-conta")
  )
    return (
      <ScopeContext.Provider value={state.identity}>
        <div className="dashboard auth-app" data-theme={theme}>
          {error && <Banner tone="danger">{error}</Banner>}
          {renderWorkspace({
            onAccount: () => navigate("minha-conta"),
            onLogout: signOut,
            busy,
          })}
        </div>
      </ScopeContext.Provider>
    );
  if (state.kind === "ready")
    return (
      <ScopeContext.Provider value={state.identity}>
        <main className="dashboard auth-app auth-workspace" data-theme={theme}>
          <section className="auth-card" aria-labelledby="auth-title">
            <header className="auth-workspace-header">
              <Brand realm={realm} />
              <div className="auth-actions">
                <button
                  className="auth-link"
                  disabled={busy}
                  onClick={() =>
                    navigate(path.endsWith("/minha-conta") ? "" : "minha-conta")
                  }
                >
                  {path.endsWith("/minha-conta") ? "Voltar" : "Minha conta"}
                </button>
                <button
                  className="auth-secondary"
                  disabled={busy}
                  onClick={signOut}
                >
                  Sair
                </button>
                <ThemeButton theme={theme} toggle={toggle} />
              </div>
            </header>
            {error && <Banner tone="danger">{error}</Banner>}
            {path.endsWith("/minha-conta") ? (
              <AccountScreen
                identity={state.identity}
                tab={tab}
                onTab={setTab}
                busy={busy}
                accountContent={
                  client.account && (tab === 1 || tab === 2) ? (
                    <AccountSecurity
                      key={tab}
                      client={client.account}
                      mode={tab === 1 ? "password" : "sessions"}
                      onBusy={setBusy}
                      onEnded={(message) => {
                        setState({ kind: "login" });
                        navigate("");
                        setError(message);
                      }}
                    />
                  ) : undefined
                }
              />
            ) : (
              <>
                <h1 id="auth-title" className="auth-sr-only">
                  {title}
                </h1>
                <p className="auth-sr-only" role="status">
                  Sessão autenticada.
                </p>
                {children ?? (
                  <p>Os módulos operacionais ainda estão em implementação.</p>
                )}
              </>
            )}
          </section>
        </main>
      </ScopeContext.Provider>
    );
  if (state.kind === "login")
    return (
      <AuthFrame {...common} split>
        <LoginScreen
          realm={realm}
          busy={busy}
          error={error}
          onSubmit={login}
          onForgot={() => navigate("esqueci-senha")}
        />
      </AuthFrame>
    );
  if (state.kind === "loading")
    return (
      <AuthFrame {...common}>
        <h1 id="auth-title">Verificando sessão</h1>
        <p role="status">Verificando sessão…</p>
      </AuthFrame>
    );
  if (state.kind === "recovery")
    return (
      <AuthFrame {...common} wide status>
        {error && <Banner tone="danger">{error}</Banner>}
        <RecoveryCodesScreen
          codes={state.codes}
          busy={busy}
          onContinue={() => {
            void perform(async (signal) => {
              try {
                await restore(signal);
              } catch (failure) {
                if (!signal.aborted) setState({ kind: "unavailable" });
                throw failure;
              }
            });
          }}
        />
      </AuthFrame>
    );
  if (state.kind === "passkey")
    return (
      <AuthFrame {...common} status={proofView !== "code"}>
        {error && <Banner tone="danger">{error}</Banner>}
        {proofView === "proof" ? (
          <PasskeyScreen
            enrollment={state.outcome.status === "enrollment_required"}
            busy={busy}
            phase={phase}
            onProof={proof}
            onCode={() => {
              setError("");
              setProofView("code");
            }}
            onCancel={signOut}
          />
        ) : proofView === "code" ? (
          <RecoveryUseScreen
            busy={busy}
            error=""
            onSubmit={recover}
            onBack={() => {
              setError("");
              setProofView("proof");
            }}
          />
        ) : (
          <StatusScreen
            screen={proofView === "unsupported" ? "unsupported" : "failure"}
            realm={realm}
            onLogin={signOut}
            onForgot={() => {}}
            onRetry={() => {
              setError("");
              setProofView("proof");
            }}
          />
        )}
      </AuthFrame>
    );
  return (
    <AuthFrame {...common} status>
      {error && <Banner tone="danger">{error}</Banner>}
      <StatusScreen
        screen={state.kind}
        realm={realm}
        variant={blocked}
        busy={busy}
        onLogin={goLogin}
        onForgot={() => navigate("esqueci-senha")}
        onRetry={() => void perform(async (signal) => restore(signal))}
      />
    </AuthFrame>
  );
}
