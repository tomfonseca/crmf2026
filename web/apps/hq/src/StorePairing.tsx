import { useCallback, useEffect, useRef, useState } from "react";
import { Heading, NetworkCard } from "./NetworkPresentation";
import { type HQStore, StoreFailure } from "./stores-client";
import {
  type PairingClient,
  type PairingMeta,
  pairingMessage,
} from "./pairing-client";
import "./stores.css";
import "./pairing.css";
const labels = {
  pending: "Emitido · uso ainda não registrado",
  used: "Uso registrado",
  revoked: "Revogado",
  expired: "Expirado",
  invalidated: "Invalidado pela configuração da loja",
};
export function StorePairing({
  store,
  client,
  canWrite,
  navigate,
  onExpired,
  refreshStore,
}: {
  store: HQStore;
  refreshStore: () => Promise<unknown>;
  client?: PairingClient;
  canWrite: boolean;
  navigate: (p: string) => void;
  onExpired: () => void;
}) {
  const [current, setCurrent] = useState<PairingMeta>(),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState(""),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState<"issue" | "revoke">();
  const active = useRef<AbortController | null>(null),
    life = useRef(true),
    canExpose = useRef(false);
  useEffect(() => {
    life.current = true;
    const hide = () => {
      canExpose.current = false;
      setSecret("");
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => {
      life.current = false;
      canExpose.current = false;
      active.current?.abort();
      active.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
    };
  }, []);
  const fail = useCallback(
    (e: unknown) => {
      setMessage(pairingMessage(e));
      if (e instanceof StoreFailure && e.status === 401) onExpired();
    },
    [onExpired],
  );
  const load = useCallback(async () => {
    if (!client || active.current) return;
    const c = new AbortController();
    active.current = c;
    setSecret("");
    setReady(false);
    setBusy(true);
    setMessage("");
    setConfirm(undefined);
    try {
      const [p] = await Promise.all([
        client.get(store.id, c.signal),
        refreshStore(),
      ]);
      if (!c.signal.aborted && life.current) {
        setCurrent(p);
        setReady(true);
      }
    } catch (e) {
      if (!c.signal.aborted && life.current) fail(e);
    } finally {
      if (active.current === c) {
        active.current = null;
        if (life.current) setBusy(false);
      }
    }
  }, [client, store.id, fail, refreshStore]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!secret) return;
    const hide = () => {
      if (document.visibilityState !== "visible") setSecret("");
    };
    const timer = window.setTimeout(() => setSecret(""), 60000);
    document.addEventListener("visibilitychange", hide);
    const pagehide = () => setSecret("");
    window.addEventListener("pagehide", pagehide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [secret]);
  async function execute() {
    if (!client || !ready || !canWrite || active.current || !confirm) return;
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setMessage("");
    setSecret("");
    const action = confirm;
    canExpose.current = document.visibilityState === "visible";
    setConfirm(undefined);
    try {
      if (action === "issue") {
        const result = await client.issue(
          store.id,
          store.version,
          current?.id ?? "",
          c.signal,
        );
        if (!c.signal.aborted && life.current) {
          setCurrent(result.current);
          if (canExpose.current && document.visibilityState === "visible")
            setSecret(result.code);
          else
            setMessage(
              "Código emitido com a tela inativa. Não é possível recuperá-lo; gere outro se necessário.",
            );
        }
      } else if (current) {
        await client.revoke(store.id, current.id, c.signal);
        if (!c.signal.aborted && life.current)
          setCurrent({ ...current, status: "revoked" });
      }
    } catch (e) {
      if (!c.signal.aborted && life.current) {
        setReady(false);
        fail(e);
      }
    } finally {
      if (active.current === c) {
        active.current = null;
        if (life.current) setBusy(false);
      }
    }
  }
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(secret);
      if (life.current)
        setMessage(
          "Código copiado. O QG não controla o histórico da área de transferência.",
        );
    } catch {
      if (life.current)
        setMessage("Não foi possível copiar. Selecione o código manualmente.");
    }
  }
  return (
    <section className="networks-page stores-page plans-page pairing-page">
      <Heading
        title="Parear dispositivo"
        trail="Clientes › Lojas"
        subtitle={store.name + " · " + store.network_name}
        action={
          <button onClick={() => navigate("/stores/" + store.id)}>
            Voltar à loja
          </button>
        }
      />
      <p className="stores-notice">
        M1 · Emissão do código disponível. Consumo pelo agente, instalador e
        confirmação de pareamento são previstos no M3. Nenhum dispositivo é
        criado ou revogado aqui.
      </p>
      {message && (
        <p role="alert" className="stores-notice stores-notice-danger">
          {message}
        </p>
      )}
      <div className="pairing-grid">
        <NetworkCard title="Código de pareamento">
          <p>8 caracteres · validade de 72 horas · exibição única</p>
          <div className="pairing-code-panel">
            {busy && <p role="status">Confirmando operação…</p>}
            {secret ? (
              <>
                <span>Código de pareamento · {store.name}</span>
                <output
                  aria-label="Código de pareamento"
                  className="pairing-secret"
                >
                  {secret.slice(0, 4)}-{secret.slice(4)}
                </output>
                <div>
                  <button className="plans-primary" onClick={() => void copy()}>
                    Copiar código
                  </button>
                  <button onClick={() => setSecret("")}>Ocultar código</button>
                </div>
              </>
            ) : ready ? (
              <p>
                {current
                  ? "O código não pode ser recuperado."
                  : "Nenhum código emitido para esta loja."}
              </p>
            ) : (
              !busy && <p>Não foi possível confirmar a emissão atual.</p>
            )}
            {ready && current && (
              <>
                <p>{labels[current.status]}</p>
                <p>
                  Validade até{" "}
                  {new Date(current.expires_at).toLocaleString("pt-BR")}{" "}
                  (horário deste navegador).
                </p>
              </>
            )}
          </div>
          <p>
            Exibido somente na resposta de emissão. Ocultado ao sair, ao mudar
            de aba ou em 60 segundos. Gerar outro invalida os anteriores; o
            código não é salvo neste navegador.
          </p>
          <div className="pairing-actions">
            <button disabled={busy || !client} onClick={() => void load()}>
              Atualizar dados
            </button>
            {canWrite && (
              <>
                <button
                  className="plans-primary"
                  disabled={busy || !ready || store.status !== "active"}
                  onClick={() => setConfirm("issue")}
                >
                  {current ? "Gerar novo código" : "Gerar código"}
                </button>
                <button
                  disabled={
                    busy ||
                    !ready ||
                    !current ||
                    current.status === "used" ||
                    current.status === "revoked"
                  }
                  onClick={() => setConfirm("revoke")}
                >
                  Revogar código
                </button>
              </>
            )}
          </div>
          {!canWrite && (
            <p>Somente administradores podem emitir ou revogar códigos.</p>
          )}
          {confirm && (
            <div
              className="stores-notice"
              role="group"
              aria-label="Confirmar operação de código"
            >
              <p>
                {confirm === "issue"
                  ? "Gerar um código para " +
                    store.name +
                    "? Todos os anteriores não utilizados serão revogados."
                  : "Revogar o código desta loja? Isso não revoga dispositivos."}
              </p>
              <button disabled={busy} onClick={() => setConfirm(undefined)}>
                Cancelar operação
              </button>
              <button disabled={busy} onClick={() => void execute()}>
                Confirmar {confirm === "issue" ? "emissão" : "revogação"}
              </button>
            </div>
          )}
        </NetworkCard>
        <NetworkCard title="Instruções de instalação">
          <p>
            Previsto · M3. Instalador, consumo do código, prova Ed25519 e
            confirmação de dispositivo ainda não estão disponíveis.
          </p>
          <button disabled>Baixar instalador · Previsto</button>
          <p>
            Não execute comandos de exemplo nem informe credenciais do ERP nesta
            tela. Código emitido não comprova agente instalado, conexão ao ERP
            ou dados sincronizados.
          </p>
        </NetworkCard>
      </div>
    </section>
  );
}
