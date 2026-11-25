// Development-only visual catalogue. Never provides ScopeContext or calls an API.
import { useState } from "react";
import type { Identity, Realm } from "./client";
import { authPreviewCases } from "./preview-cases";
import { AuthFrame, Brand, ThemeButton, type Theme } from "./layout";
import {
  AccountScreen,
  LoginScreen,
  PasskeyScreen,
  RecoveryCodesScreen,
  RecoveryUseScreen,
  StatusScreen,
  type StaticScreen,
} from "./screens";
import "./auth.css";
const noop = () => {};
export function AuthDesignPreview() {
  const [file, setFile] = useState<string>("Login.html");
  const [theme, setTheme] = useState<Theme>("light");
  const [tab, setTab] = useState(0);
  const realm: Realm = file.includes("--realm-cliente")
    ? "tenant"
    : file.startsWith("QG-") || file.includes("--realm-qg")
      ? "platform"
      : "tenant";
  const base = file.split("--")[0].replace(".html", "");
  const variant = file.split("--estado-")[1]?.replace(".html", "") ?? "";
  const common = {
    realm,
    theme,
    toggle: () => setTheme((v) => (v === "light" ? "dark" : "light")),
  };
  const staticScreens: Record<string, StaticScreen> = {
    EsqueciSenha: "forgot",
    NovaSenha: "reset",
    "Convite-Aceite": "invite",
    "Link-Invalido": "invalid",
    "Sessao-Expirada": "expired",
    "Acesso-Bloqueado": "blocked",
    "Auth-Indisponivel": "unavailable",
    "Passkey-Falha": variant === "expirada" ? "challenge-expired" : "failure",
    "Passkey-SemSuporte": "unsupported",
  };
  const identity: Identity = {
    realm,
    user_id: "00000000-0000-7000-8000-000000000001",
    ...(realm === "tenant"
      ? { tenant_id: "00000000-0000-7000-8000-000000000002" }
      : {}),
    store_ids: [],
    grants: [
      { role: realm === "platform" ? "platform_admin" : "network_admin" },
    ],
  };
  let content;
  if (base === "Conta" || base === "QG-Conta")
    content = (
      <main className="auth-app auth-workspace" data-theme={theme}>
        <section className="auth-card">
          <header className="auth-workspace-header">
            <Brand realm={realm} />
            <ThemeButton theme={theme} toggle={common.toggle} />
          </header>
          <AccountScreen
            identity={identity}
            tab={tab}
            onTab={setTab}
            preview
            security={
              file.includes("sem-passkey")
                ? "sem-passkey-opcional"
                : file.includes("aba-seguranca")
                  ? "politica-obrigatoria"
                  : "com-passkey"
            }
          />
        </section>
      </main>
    );
  else {
    let screen;
    if (["Login", "QG-Login", "Login-Mobile"].includes(base))
      screen = (
        <LoginScreen
          key={file}
          initialErrors={variant === "obrigatorios"}
          realm={realm}
          busy={variant === "enviando"}
          error={
            variant === "credenciais"
              ? "E-mail ou senha incorretos. Confira os dados e tente de novo."
              : ""
          }
          onSubmit={noop}
          onForgot={noop}
        />
      );
    else if (base === "Codigos-Recuperacao")
      screen = (
        <RecoveryCodesScreen
          key={file}
          codes={Array.from({ length: 10 }, (_, i) =>
            (i + 1).toString(16).padStart(32, "0"),
          )}
          busy={false}
          onContinue={noop}
        />
      );
    else if (base === "Codigo-Uso")
      screen = (
        <RecoveryUseScreen
          key={file}
          busy={variant === "verificando"}
          error={
            variant === "invalido"
              ? "Não foi possível validar o código. Confira os dados e tente novamente."
              : ""
          }
          onSubmit={noop}
          onBack={noop}
        />
      );
    else if (
      ["Passkey", "QG-Passkey-Primeiro", "Passkey-Verificar"].includes(base)
    )
      screen = (
        <PasskeyScreen
          enrollment={base !== "Passkey-Verificar"}
          busy={["navegador", "verificando"].includes(variant)}
          phase={variant === "navegador" ? "browser" : "verify"}
          onProof={noop}
          onCode={noop}
          onCancel={noop}
        />
      );
    else
      screen = (
        <StatusScreen
          screen={staticScreens[base]}
          busy={variant === "tentando"}
          realm={realm}
          variant={
            file.includes("fluxo-convite")
              ? "fluxo-convite"
              : file.includes("--tipo-")
                ? file.split("--tipo-")[1].replace(".html", "")
                : variant
          }
          preview
          onLogin={noop}
          onRetry={noop}
          onForgot={noop}
        />
      );
    content = (
      <AuthFrame
        {...common}
        split={["Login", "QG-Login", "Login-Mobile"].includes(base)}
        wide={base === "Codigos-Recuperacao"}
        status={
          ![
            "Login",
            "QG-Login",
            "Login-Mobile",
            "EsqueciSenha",
            "NovaSenha",
            "Convite-Aceite",
            "Codigo-Uso",
          ].includes(base) ||
          variant === "concluido" ||
          (base === "EsqueciSenha" && variant === "enviado")
        }
      >
        {screen}
      </AuthFrame>
    );
  }
  return (
    <>
      <aside className="auth-preview-controls">
        <strong>Prévia visual — dados sintéticos.</strong>
        <span>
          Não autentica, não envia e-mails e não altera contas. Use somente
          dados fictícios.
        </span>
        <label>
          Prancheta{" "}
          <select
            value={file}
            onChange={(e) => {
              const next = e.target.value;
              setFile(next);
              setTheme(next.includes("tema-escuro") ? "dark" : "light");
              setTab(
                next.includes("aba-senha")
                  ? 1
                  : next.includes("aba-sessoes")
                    ? 2
                    : next.includes("seguranca")
                      ? 3
                      : 0,
              );
            }}
          >
            {authPreviewCases.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <span>{authPreviewCases.length} variações</span>
      </aside>
      <div
        className={base === "Login-Mobile" ? "auth-mobile-preview" : undefined}
      >
        {content}
      </div>
    </>
  );
}
