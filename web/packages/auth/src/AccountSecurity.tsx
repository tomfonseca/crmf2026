import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AuthFailure,
  authMessage,
  type AccountClient,
  type OwnSession,
  type SessionPage,
} from "./client";
import { Banner, PasswordField, PasswordRules } from "./layout";

export function AccountSecurity({
  client,
  mode,
  onEnded,
  onBusy,
}: {
  client: AccountClient;
  mode: "password" | "sessions";
  onEnded: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [page, setPage] = useState<SessionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [target, setTarget] = useState<OwnSession | null>(null);
  const [next, setNext] = useState("");
  const pending = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const life = useRef(false);
  useEffect(() => {
    life.current = true;
    return () => {
      life.current = false;
      pending.current?.abort();
      onBusy(false);
    };
  }, [onBusy]);
  async function load(after?: string) {
    if (locked.current) return;
    pending.current?.abort();
    const c = new AbortController();
    pending.current = c;
    setLoading(true);
    setError("");
    setPage(null);
    setTarget(null);
    try {
      const p = await client.sessions(after, c.signal);
      if (!c.signal.aborted && life.current) {
        setPage(p);
        setUncertain(false);
      }
    } catch (e) {
      if (!c.signal.aborted && life.current) {
        if (e instanceof AuthFailure && e.status === 401)
          onEnded("Sua sessão terminou. Entre novamente.");
        else setError(authMessage(e));
      }
    } finally {
      if (!c.signal.aborted && life.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (mode === "sessions") void load();
    return () => pending.current?.abort();
  }, [client, mode]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (
        locked.current ||
        form.current?.querySelector<HTMLInputElement>("input")?.value ||
        next
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [next]);
  async function mutate(
    call: (signal: AbortSignal) => Promise<void>,
    success: () => void,
  ) {
    if (locked.current || uncertain) return;
    locked.current = true;
    pending.current?.abort();
    const c = new AbortController();
    pending.current = c;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await call(c.signal);
      if (!c.signal.aborted && life.current) success();
    } catch (e) {
      if (!c.signal.aborted && life.current) {
        const known =
          e instanceof AuthFailure &&
          [400, 401, 402, 403, 404, 429].includes(e.status);
        setUncertain(!known);
        if (e instanceof AuthFailure && e.status === 401)
          onEnded("Sua sessão terminou. Entre novamente.");
        else
          setError(
            e instanceof AuthFailure && e.kind === "current_password_invalid"
              ? "Não foi possível confirmar a senha atual."
              : e instanceof AuthFailure && e.kind === "password_policy"
                ? "Use uma senha diferente, com ao menos 12 caracteres, até 1024 bytes e que não seja comum."
                : known
                  ? authMessage(e)
                  : "Não foi possível confirmar a operação. Não repita automaticamente. Atualize as sessões ou saia e confira o acesso com a nova senha.",
          );
      }
    } finally {
      locked.current = false;
      if (life.current && !c.signal.aborted) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const current = String(data.get("current") ?? ""),
      password = String(data.get("next") ?? "");
    if (
      !current ||
      Array.from(password).length < 12 ||
      new TextEncoder().encode(password).length > 1024 ||
      password !== String(data.get("confirmation") ?? "") ||
      current === password
    ) {
      setError(
        "Informe a senha atual e confirme uma nova senha diferente, com pelo menos 12 caracteres e até 1024 bytes.",
      );
      return;
    }
    void mutate(
      (signal) => client.changePassword(current, password, signal),
      () =>
        onEnded(
          "Senha alterada. Todas as sessões foram encerradas. Suas passkeys continuam válidas.",
        ),
    );
    // Clear secret DOM/state even on uncertain responses; never persist or echo.
    e.currentTarget.reset();
    setNext("");
  }
  const format = (date: string) => new Date(date).toLocaleString("pt-BR");
  return (
    <>
      {error && <Banner tone="danger">{error}</Banner>}
      {notice && <Banner>{notice}</Banner>}
      {mode === "password" ? (
        <>
          <Banner>
            A troca exige sua senha atual e encerra todas as sessões. Suas
            passkeys e códigos de recuperação continuam válidos.
          </Banner>
          <form ref={form} onSubmit={submit} noValidate>
            <fieldset disabled={busy || uncertain}>
              <PasswordField
                label="Senha atual"
                name="current"
                autoComplete="current-password"
                required
                maxLength={1024}
              />
              <PasswordField
                label="Nova senha"
                name="next"
                autoComplete="new-password"
                required
                maxLength={1024}
                onChange={(e) => setNext(e.target.value)}
              />
              <PasswordRules password={next} />
              <PasswordField
                label="Confirmar nova senha"
                name="confirmation"
                autoComplete="new-password"
                required
                maxLength={1024}
              />
              <button className="auth-primary" type="submit">
                {busy ? "Salvando…" : "Salvar senha"}
              </button>
            </fieldset>
          </form>
        </>
      ) : (
        <>
          <p>
            Somente sessões ativas desta conta e deste ambiente. Dados do
            navegador/dispositivo não são disponibilizados nesta tela. Não há
            atualização automática.
          </p>
          <button
            className="auth-secondary"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            Atualizar sessões
          </button>
          {loading ? (
            <p role="status">Carregando sessões…</p>
          ) : page ? (
            <>
              {!page.items.length ? (
                <p>Nenhuma sessão ativa nesta página.</p>
              ) : (
                <div className="auth-session-table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Sessão",
                          "Iniciada em",
                          "Última atividade",
                          "Expira por inatividade",
                          "Ação",
                        ].map((h) => (
                          <th key={h} scope="col">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.current ? "Esta sessão" : "Outra sessão"}
                            <br />
                            <small>{s.id}</small>
                          </td>
                          <td>{format(s.created_at)}</td>
                          <td>{format(s.last_seen_at)}</td>
                          <td>{format(s.idle_expires_at)}</td>
                          <td>
                            <button
                              className="auth-secondary"
                              disabled={busy || uncertain}
                              onClick={() => setTarget(s)}
                              aria-label={
                                s.current
                                  ? "Encerrar esta sessão"
                                  : `Encerrar sessão ${s.id}`
                              }
                            >
                              Encerrar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {page.next_cursor && (
                <button
                  className="auth-secondary"
                  disabled={busy}
                  onClick={() => void load(page.next_cursor)}
                >
                  Próxima página
                </button>
              )}
            </>
          ) : (
            <p>Dados de sessões indisponíveis.</p>
          )}
          {target && (
            <SessionConfirmation
              target={target}
              busy={busy}
              disabled={uncertain}
              onCancel={() => setTarget(null)}
              onConfirm={() =>
                void mutate(
                  (signal) => client.endSession(target.id, signal),
                  () => {
                    if (target.current) onEnded("Sessão encerrada.");
                    else {
                      setTarget(null);
                      setPage((p) =>
                        p
                          ? {
                              ...p,
                              items: p.items.filter((s) => s.id !== target.id),
                            }
                          : p,
                      );
                      setNotice(
                        "Sessão encerrada. Atualize para conferir a lista atual.",
                      );
                    }
                  },
                )
              }
            />
          )}
        </>
      )}
    </>
  );
}
function SessionConfirmation({
  target,
  busy,
  disabled,
  onCancel,
  onConfirm,
}: {
  target: OwnSession;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      className="auth-session-dialog"
      ref={ref}
      aria-labelledby="session-confirm-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onCancel();
      }}
    >
      <h3 id="session-confirm-title">
        {target.current ? "Encerrar esta sessão?" : "Encerrar sessão?"}
      </h3>
      <p>
        {target.current
          ? "Você precisará entrar novamente."
          : "O acesso por esta sessão será encerrado na próxima requisição autenticada."}
      </p>
      <div className="auth-actions">
        <button className="auth-secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="auth-primary"
          disabled={busy || disabled}
          onClick={onConfirm}
        >
          Confirmar encerramento
        </button>
      </div>
    </dialog>
  );
}
