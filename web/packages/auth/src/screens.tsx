import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Identity, Realm } from "./client";
import {
  Banner,
  Icon,
  PasswordField,
  PasswordRules,
  Planned,
  StatusIcon,
} from "./layout";

export function LoginScreen({
  realm,
  busy,
  error,
  onSubmit,
  onForgot,
  initialErrors = false,
}: {
  initialErrors?: boolean;
  realm: Realm;
  busy: boolean;
  error: string;
  onSubmit: (email: string, password: string) => void;
  onForgot: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [invalid, setInvalid] = useState({
    email: initialErrors ? "Informe o e-mail." : "",
    password: initialErrors ? "Informe a senha." : "",
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const fields = {
      email: !email
        ? "Informe o e-mail."
        : !event.currentTarget.querySelector<HTMLInputElement>('[name="email"]')
              ?.validity.valid
          ? "Informe um e-mail válido."
          : "",
      password: password ? "" : "Informe a senha.",
    };
    setInvalid(fields);
    if (fields.email || fields.password) {
      form.current
        ?.querySelector<HTMLInputElement>(
          `[name="${fields.email ? "email" : "password"}"]`,
        )
        ?.focus();
      return;
    }
    event.currentTarget.reset();
    onSubmit(email, password);
  }
  return (
    <form onSubmit={submit} ref={form} noValidate aria-busy={busy}>
      <h1 id="auth-title">
        {realm === "platform" ? "Entrar no QG" : "Entrar"}
      </h1>
      <p className="auth-subtitle">
        {realm === "platform"
          ? "Acesse a gestão da plataforma CRM Farma."
          : "Acompanhe as vendas e metas da sua rede."}
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="auth-field">
        <label htmlFor={id}>E-mail</label>
        <input
          id={id}
          name="email"
          type="email"
          autoComplete="username"
          placeholder="voce@empresa.com.br"
          maxLength={320}
          required
          disabled={busy}
          aria-invalid={!!invalid.email}
          aria-describedby={invalid.email ? `${id}-error` : undefined}
        />
        {invalid.email && (
          <small id={`${id}-error`} className="auth-field-error">
            {invalid.email}
          </small>
        )}
      </div>
      <PasswordField
        name="password"
        autoComplete="current-password"
        maxLength={1024}
        required
        disabled={busy}
        error={invalid.password}
        aside={
          <a
            className="auth-link"
            href={
              realm === "platform" ? "/esqueci-senha" : "/login/esqueci-senha"
            }
            aria-disabled={busy}
            tabIndex={busy ? -1 : undefined}
            onClick={(event) => {
              if (busy) {
                event.preventDefault();
                return;
              }
              if (
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                onForgot();
              }
            }}
          >
            Esqueci minha senha
          </a>
        }
      />
      <button className="auth-primary" type="submit" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
      <p className="auth-note">
        O acesso é criado pelo administrador{" "}
        {realm === "platform" ? "da plataforma" : "da sua rede"}. Não há
        cadastro público.
      </p>
    </form>
  );
}
export function PasskeyScreen({
  enrollment,
  busy,
  phase,
  onProof,
  onCode,
  onCancel,
}: {
  enrollment: boolean;
  busy: boolean;
  phase: "browser" | "verify";
  onProof: () => void;
  onCode: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <StatusIcon icon="key" />
      <h1 id="auth-title">
        {enrollment ? "Cadastrar passkey" : "Verificar passkey"}
      </h1>
      <p className="auth-subtitle">
        {enrollment
          ? "Proteja seu acesso com uma passkey."
          : "Confirme que é você com a passkey cadastrada."}
      </p>
      <p className="auth-help">
        Use Windows Hello, PIN, biometria ou uma chave de segurança. A janela é
        do navegador; a chave privada e a biometria não são enviadas ao CRM
        Farma.
      </p>
      {busy && (
        <Banner>
          {phase === "browser"
            ? "Siga as instruções do navegador. O desafio expira em até 5 minutos."
            : "Verificando a resposta com o servidor…"}
        </Banner>
      )}
      <button className="auth-primary" onClick={onProof} disabled={busy}>
        <Icon name="key" />
        {busy ? "Verificando…" : enrollment ? "Criar passkey" : "Usar passkey"}
      </button>
      {!enrollment && (
        <details>
          <summary>Usar um código de recuperação</summary>
          <p>
            Use apenas se não conseguir acessar sua passkey. Cada código
            funciona uma única vez.
          </p>
          <button className="auth-link" disabled={busy} onClick={onCode}>
            Continuar com código
          </button>
        </details>
      )}
      <button
        className="auth-link auth-cancel"
        onClick={onCancel}
        disabled={busy && phase === "verify"}
      >
        {busy ? "Cancelar" : "Cancelar e voltar"}
      </button>
    </>
  );
}
export function RecoveryUseScreen({
  busy,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  error: string;
  onSubmit: (code: string) => void;
  onBack: () => void;
}) {
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  return (
    <>
      <h1 id="auth-title">Entrar com código de recuperação</h1>
      <p className="auth-subtitle">
        Cada código funciona uma única vez. Esta opção não substitui o cadastro
        inicial da passkey.
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get("code") ?? "")
            .replace(/\s/g, "")
            .toLowerCase();
          if (!/^[a-f0-9]{32}$/.test(code)) {
            setInvalid(true);
            return;
          }
          e.currentTarget.reset();
          setInvalid(false);
          onSubmit(code);
        }}
      >
        <div className="auth-field">
          <label htmlFor={id}>Código de recuperação</label>
          <input
            id={id}
            name="code"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            required
            maxLength={35}
            aria-invalid={invalid}
            aria-describedby={`${id}-help`}
          />
          <small
            id={`${id}-help`}
            className={invalid ? "auth-field-error" : ""}
          >
            {invalid
              ? "Informe um código com 32 caracteres, letras de a a f e números."
              : "32 caracteres, letras de a a f e números. Espaços entre os blocos são permitidos."}
          </small>
        </div>
        <button className="auth-primary" disabled={busy}>
          {busy ? "Verificando…" : "Usar código de recuperação"}
        </button>
      </form>
      <button
        className="auth-link auth-cancel"
        disabled={busy}
        onClick={onBack}
      >
        Voltar para a passkey
      </button>
    </>
  );
}
export function RecoveryCodesScreen({
  codes,
  busy,
  onContinue,
}: {
  codes: readonly string[];
  busy: boolean;
  onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const content = codes
    .map((code) => code.match(/.{1,8}/g)?.join(" "))
    .join("\n");
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setNotice(
        "Códigos copiados. Guarde-os em local seguro e limpe a área de transferência ao terminar.",
      );
    } catch {
      setNotice(
        "Não foi possível copiar. Selecione os códigos ou baixe o arquivo.",
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([content + "\n"], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "crm-farma-codigos-recuperacao.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <StatusIcon icon="key" />
      <h1 id="auth-title">Guarde seus códigos de recuperação</h1>
      <Banner tone="warn">
        Eles aparecem apenas uma vez. Cada código pode ser usado uma única vez.
        Guarde-os fora deste dispositivo, em um local seguro.
      </Banner>
      <ol className="auth-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code.match(/.{1,8}/g)?.join(" ")}</code>
          </li>
        ))}
      </ol>
      <div className="auth-actions">
        <button className="auth-secondary" onClick={() => void copy()}>
          Copiar todos
        </button>
        <button className="auth-secondary" onClick={download}>
          Baixar .txt
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <label className="auth-check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        Guardei os códigos em um local seguro.
      </label>
      <button
        className="auth-primary"
        disabled={!saved || busy}
        onClick={onContinue}
      >
        {busy ? "Verificando…" : "Continuar"}
      </button>
    </>
  );
}
export type StaticScreen =
  | "forgot"
  | "reset"
  | "invite"
  | "invalid"
  | "expired"
  | "challenge-expired"
  | "blocked"
  | "unavailable"
  | "unsupported"
  | "failure";
export function StatusScreen({
  screen,
  realm,
  busy = false,
  onLogin,
  onRetry,
  onForgot,
  variant = "",
  preview = false,
}: {
  screen: StaticScreen;
  realm: Realm;
  busy?: boolean;
  onLogin: () => void;
  onRetry: () => void;
  onForgot: () => void;
  variant?: string;
  preview?: boolean;
}) {
  if (screen === "forgot")
    return (
      <>
        {preview && variant === "enviado" && (
          <StatusIcon icon="mail" tone="ok" />
        )}
        <h1 id="auth-title">
          {preview && variant === "enviado"
            ? "Verifique seu e-mail"
            : "Esqueci minha senha"}
        </h1>
        <p className="auth-subtitle">
          Informe seu e-mail para receber um link de redefinição de senha.
        </p>
        {preview && variant === "enviado" ? (
          <>
            <Banner tone="ok">
              Se este e-mail estiver cadastrado, você receberá as instruções
              para redefinir sua senha.
            </Banner>
            <button className="auth-secondary" disabled>
              Usar outro e-mail
            </button>
          </>
        ) : (
          <>
            {!preview && (
              <PendingNotice text="O envio de links de redefinição ainda não está disponível. Entre em contato com o administrador. Nenhum e-mail será enviado por esta tela." />
            )}
            <form onSubmit={(e) => e.preventDefault()}>
              <fieldset disabled>
                <EmailField />
                <button className="auth-primary">
                  {variant === "enviando"
                    ? "Enviando…"
                    : "Enviar link de redefinição"}
                </button>
              </fieldset>
            </form>
          </>
        )}
        <button className="auth-link auth-cancel" onClick={onLogin}>
          Voltar para o login
        </button>
      </>
    );
  if (screen === "reset" || screen === "invite")
    return (
      <>
        {preview && variant === "concluido" && (
          <StatusIcon icon="check" tone="ok" />
        )}
        <h1 id="auth-title">
          {preview && variant === "concluido"
            ? screen === "invite"
              ? "Acesso ativado"
              : "Senha redefinida"
            : screen === "invite"
              ? "Aceitar convite"
              : "Criar nova senha"}
        </h1>
        <p className="auth-subtitle">
          {screen === "invite"
            ? "Defina sua senha para acessar o CRM Farma."
            : "Use uma senha forte e diferente das anteriores."}
        </p>
        {preview && variant === "concluido" ? (
          <>
            <Banner tone="ok">
              {screen === "invite"
                ? "Senha definida. Faça login para continuar."
                : "Senha redefinida. Todas as sessões foram encerradas; suas passkeys continuam válidas."}
            </Banner>
          </>
        ) : (
          <>
            {!preview && (
              <PendingNotice text="A validação e o uso deste link ainda não estão disponíveis. Nenhuma senha será alterada. Solicite orientação ao administrador." />
            )}
            {screen === "invite" && (
              <Banner tone="neutral">
                {preview
                  ? "Convite para Rede de demonstração · papel Colaborador"
                  : "Os dados da rede, papel e e-mail só serão exibidos após a validação do convite pelo servidor."}
              </Banner>
            )}
            <NewPasswordForm
              invitation={screen === "invite"}
              preview={preview}
              variant={variant}
            />
          </>
        )}
        <button className="auth-link auth-cancel" onClick={onLogin}>
          {variant === "concluido" ? "Ir para o login" : "Voltar para o login"}
        </button>
      </>
    );
  const definitions: Record<
    Exclude<StaticScreen, "forgot" | "reset" | "invite">,
    { title: string; text: string; icon: string }
  > = {
    invalid: {
      title: preview
        ? variant === "usado"
          ? "Este link já foi usado"
          : variant === "invalido"
            ? "Link inválido"
            : "Este link expirou"
        : "Link indisponível",
      text:
        variant === "fluxo-convite"
          ? "Este convite não pode ser utilizado. Peça ao administrador um novo convite."
          : "Este link é inválido, já foi usado ou expirou. Solicite um novo link para continuar.",
      icon: "warning",
    },
    expired: {
      title: "Sua sessão expirou",
      text:
        realm === "platform"
          ? "Por segurança, a sessão do QG dura até 30 minutos sem uso ou 12 horas no total. Entre novamente."
          : "Por segurança, sua sessão dura até 12 horas sem uso ou 7 dias no total. Entre novamente.",
      icon: "clock",
    },
    "challenge-expired": {
      title: "O pedido expirou",
      text: "O desafio expirou. Entre novamente com e-mail e senha para iniciar uma nova verificação.",
      icon: "clock",
    },
    blocked: {
      title:
        variant === "bloqueio"
          ? "Muitas tentativas"
          : preview && variant === "desativada"
            ? "Conta desativada"
            : "Acesso não permitido",
      text: "Não foi possível autorizar seu acesso. Confira se está no ambiente correto ou fale com o administrador. O tempo de bloqueio e a existência da conta não são informados.",
      icon: "lock",
    },
    unavailable: {
      title: "Não foi possível verificar sua sessão",
      text: "Não foi possível verificar seu acesso. Tente novamente. Nenhum acesso de demonstração foi concedido.",
      icon: "warning",
    },
    unsupported: {
      title: "Este navegador não suporta passkeys",
      text: "Use um navegador atualizado com suporte a passkeys e uma conexão HTTPS (ou localhost no desenvolvimento).",
      icon: "key",
    },
    failure: {
      title: preview
        ? variant === "recusada"
          ? "Passkey não reconhecida"
          : "Verificação cancelada"
        : variant === "cancelada"
          ? "Verificação cancelada"
          : "Não foi possível verificar a passkey",
      text: "A verificação foi cancelada, recusada ou não pôde ser concluída. Nenhum acesso foi concedido.",
      icon: "warning",
    },
  };
  const entry = definitions[screen];
  return (
    <>
      <StatusIcon
        icon={entry.icon}
        tone={screen === "expired" ? "info" : "warn"}
      />
      <h1 id="auth-title">{entry.title}</h1>
      <p className="auth-subtitle">{entry.text}</p>
      {screen === "unsupported" && (
        <Banner tone="warn">
          Não existe forma de entrar sem a passkey quando ela é exigida.
        </Banner>
      )}
      {["failure", "unavailable"].includes(screen) && (
        <button className="auth-primary" disabled={busy} onClick={onRetry}>
          {busy ? "Tentando…" : "Tentar novamente"}
        </button>
      )}
      {((screen === "invalid" && variant !== "fluxo-convite") ||
        (screen === "blocked" && variant === "bloqueio")) && (
        <button className="auth-secondary" onClick={onForgot}>
          {screen === "invalid" ? "Pedir novo link" : "Redefinir senha"}
        </button>
      )}
      <button
        className={
          screen === "expired" || screen === "challenge-expired"
            ? "auth-primary"
            : "auth-link auth-cancel"
        }
        disabled={busy}
        onClick={onLogin}
      >
        {screen === "expired" ? "Entrar novamente" : "Voltar para o login"}
      </button>
    </>
  );
}
function EmailField({ invitationEmail }: { invitationEmail?: string } = {}) {
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>E-mail</label>
      <input
        id={id}
        type="email"
        autoComplete="username"
        placeholder="voce@empresa.com.br"
        readOnly={invitationEmail !== undefined}
        defaultValue={invitationEmail}
      />
    </div>
  );
}
function NewPasswordForm({
  invitation,
  variant,
  preview = false,
}: {
  invitation?: boolean;
  variant?: string;
  preview?: boolean;
}) {
  const [password, setPassword] = useState(
    variant === "senha-fraca" ? "123" : "",
  );
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <fieldset disabled={!preview || variant === "salvando"}>
        {invitation && (
          <EmailField
            invitationEmail={preview ? "convite@example.invalid" : ""}
          />
        )}
        <PasswordField
          label="Nova senha"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={
            variant === "senha-fraca"
              ? "Use uma senha com pelo menos 12 caracteres que não seja comum."
              : undefined
          }
        />
        <PasswordRules password={password} />
        <PasswordField
          label="Confirmar nova senha"
          autoComplete="new-password"
        />
        <button className="auth-primary" disabled>
          {variant === "salvando" ? "Salvando…" : "Salvar senha"}
        </button>
      </fieldset>
    </form>
  );
}
export function PendingNotice({ text }: { text: string }) {
  return (
    <Banner tone="warn">
      <Planned /> {text}
    </Banner>
  );
}
const roleNames: Record<string, string> = {
  platform_admin: "Administrador da plataforma",
  platform_support: "Suporte da plataforma",
  network_admin: "Administrador da rede",
  store_manager: "Gerente de loja",
  employee: "Colaborador",
};
export function AccountScreen({
  identity,
  tab,
  onTab,
  preview = false,
  security = "",
}: {
  identity: Identity;
  tab: number;
  onTab: (tab: number) => void;
  preview?: boolean;
  security?: string;
}) {
  const tabs = ["Perfil", "Senha", "Sessões", "Segurança e passkeys"];
  const id = useId();
  return (
    <div className="auth-account">
      <p className="auth-eyebrow">CONTA</p>
      <h1 id="auth-title">Minha conta</h1>
      <div role="tablist" aria-label="Minha conta" className="auth-tabs">
        {tabs.map((title, index) => (
          <button
            key={title}
            type="button"
            role="tab"
            id={`${id}-${index}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === index}
            tabIndex={tab === index ? 0 : -1}
            onClick={() => onTab(index)}
            onKeyDown={(e) => {
              const next =
                e.key === "ArrowRight"
                  ? (index + 1) % 4
                  : e.key === "ArrowLeft"
                    ? (index + 3) % 4
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 3
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                onTab(next);
                document.getElementById(`${id}-${next}`)?.focus();
              }
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        className="auth-account-panel"
      >
        <h2>
          {tabs[tab]} {tab > 0 && <Planned />}
        </h2>
        {tab === 0 ? (
          <>
            <p>
              Nome, papel, rede e lojas autorizadas são administrados pelo
              responsável pelo seu acesso.
            </p>
            <dl className="auth-profile">
              {[
                [
                  "Nome",
                  preview
                    ? "Pessoa de demonstração"
                    : "Não disponibilizado pela API",
                ],
                [
                  "E-mail",
                  preview
                    ? "pessoa@example.invalid"
                    : "Não disponibilizado pela API",
                ],
                [
                  "Papel",
                  identity.grants
                    .map((g) => roleNames[g.role] ?? "Não informado")
                    .join(", "),
                ],
                ["Rede", identity.tenant_id ?? "Plataforma"],
                [
                  "Lojas autorizadas",
                  identity.store_ids.length
                    ? identity.store_ids.join(", ")
                    : identity.realm === "platform"
                      ? "Não se aplica"
                      : "Nenhuma loja atribuída",
                ],
                ["Último acesso", "Não disponibilizado pela API"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : tab === 1 ? (
          <>
            <PendingNotice text="A troca de senha ainda depende da integração com a API. Exigirá sua senha atual e encerrará as sessões conforme a política de segurança." />
            <fieldset disabled>
              <PasswordField
                label="Senha atual"
                autoComplete="current-password"
              />
              <PasswordField label="Nova senha" autoComplete="new-password" />
              <PasswordRules password="" />
              <PasswordField
                label="Confirmar nova senha"
                autoComplete="new-password"
              />
              <button className="auth-primary">Salvar senha</button>
            </fieldset>
          </>
        ) : tab === 2 ? (
          <>
            <PendingNotice text="A listagem e o encerramento seletivo de sessões ainda não estão disponíveis. Não é possível identificar dispositivos ou horários com a API atual." />
            <EmptyTable
              headers={["Dispositivo", "Último uso", "Situação", "Ação"]}
              text="Dados de sessões indisponíveis"
            />
            <button className="auth-secondary" disabled>
              Encerrar todas as outras
            </button>
          </>
        ) : (
          <>
            <Banner>
              {identity.realm === "platform"
                ? "A plataforma exige passkey para todos os papéis."
                : preview && security === "politica-obrigatoria"
                  ? "Sua rede exige passkey para todos os usuários."
                  : "A exigência e as passkeys cadastradas serão exibidas após integração com a API de segurança."}
            </Banner>
            <EmptyTable
              headers={["Passkey", "Criada em", "Último uso", "Ações"]}
              text={
                preview && security === "sem-passkey-opcional"
                  ? "Prévia: cadastro opcional de passkey"
                  : "Listagem de passkeys ainda indisponível"
              }
            />
            <p>
              Remover a última passkey quando ela é obrigatória não será
              permitido. Cadastrar chaves adicionais, remover passkeys e gerar
              novos códigos dependem de validação de segurança.
            </p>
            <div className="auth-actions">
              <button className="auth-secondary" disabled>
                {preview && security === "sem-passkey-opcional"
                  ? "Cadastrar passkey"
                  : "Adicionar outra chave"}
              </button>
              <button className="auth-secondary" disabled>
                Remover passkey
              </button>
              <button className="auth-secondary" disabled>
                Gerar novos códigos de recuperação
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
function EmptyTable({ headers, text }: { headers: string[]; text: ReactNode }) {
  return (
    <div
      className="auth-table-wrap"
      role="region"
      aria-label={String(headers[0])}
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={headers.length}>{text}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
