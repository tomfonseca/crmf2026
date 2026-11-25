import { useEffect, useRef, useState, type ReactNode } from "react";
import "./qg-layout.css";
export type WorkspaceActions = {
  onAccount: () => void;
  onLogout: () => void;
  busy: boolean;
};
const groups = [
  ["Visão geral", ["Painel", "/overview"]],
  [
    "Clientes",
    ["Redes", "/tenants"],
    ["Lojas", "/stores"],
    ["Dispositivos", "/devices"],
    ["Monitor de envios", "/batches"],
  ],
  [
    "Catálogo",
    ["Planos", "/plans"],
    ["Releases", "/releases"],
    ["Conectores", "/connectors"],
  ],
  ["Administração", ["Usuários internos", "/users"], ["Auditoria", "/audit"]],
] as const;
export function Shell({
  children,
  path,
  navigate,
  theme,
  toggleTheme,
  support,
  actions,
}: {
  children: ReactNode;
  path: string;
  navigate: (path: string) => void;
  theme: string;
  toggleTheme: () => void;
  support: boolean;
  actions?: WorkspaceActions;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem("crmf.hq.sidebar");
      return stored
        ? stored === "collapsed"
        : matchMedia("(min-width:992px) and (max-width:1279px)").matches;
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false),
    [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null),
    drawerButton = useRef<HTMLButtonElement>(null),
    sidebar = useRef<HTMLElement>(null),
    userMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drawer) sidebar.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [drawer]);
  useEffect(() => {
    if (menu)
      userMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawer(false);
        setMenu(false);
        (drawer ? drawerButton : menuButton).current?.focus();
      }
      if (e.key === "Tab" && drawer) {
        const items =
          sidebar.current?.querySelectorAll<HTMLElement>("a,button");
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawer]);
  function toggle() {
    if (matchMedia("(max-width:991px)").matches) setDrawer((v) => !v);
    else {
      const next = !collapsed;
      setCollapsed(next);
      try {
        localStorage.setItem(
          "crmf.hq.sidebar",
          next ? "collapsed" : "expanded",
        );
      } catch {
        /* optional preference */
      }
    }
  }
  return (
    <div
      className={
        "qg-shell" +
        (collapsed ? " is-collapsed" : "") +
        (drawer ? " drawer-open" : "")
      }
    >
      <a className="qg-skip" href="#qg-content">
        Pular para o conteúdo
      </a>
      {drawer && (
        <button
          className="qg-scrim"
          aria-label="Fechar menu"
          onClick={() => {
            setDrawer(false);
            drawerButton.current?.focus();
          }}
        />
      )}
      <aside
        className="qg-sidebar"
        ref={sidebar}
        aria-label="Navegação principal"
      >
        <div className="qg-brand">
          <b aria-hidden="true">C</b>
          <strong>CRM Farma</strong>
          <span>QG</span>
        </div>
        <nav aria-label="Menu do QG">
          {groups.map(([group, ...items]) => (
            <div className="qg-nav-group" key={group}>
              <p>{group}</p>
              {items.map(([label, url]) => (
                <a
                  key={url}
                  title={label}
                  href={url}
                  aria-current={
                    (path === "/" && url === "/plans") || path.startsWith(url)
                      ? "page"
                      : undefined
                  }
                  onClick={(e) => {
                    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                      e.preventDefault();
                      navigate(url);
                      setDrawer(false);
                    }
                  }}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path
                      d={
                        url === "/overview"
                          ? "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"
                          : url === "/plans"
                            ? "M3 3h8l10 10-8 8L3 11zM7 7h.01"
                            : "M4 20V5h16v15M8 9h2m4 0h2M8 13h2m4 0h2M8 17h8"
                      }
                    />
                  </svg>
                  <span>{label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <a
          className="qg-doc"
          href="https://github.com/tomfonseca/crmf2026/tree/main/docs"
          target="_blank"
          rel="noreferrer"
        >
          Documentação
        </a>
      </aside>
      <div className="qg-body">
        <header className="qg-topbar">
          <button
            ref={drawerButton}
            className="qg-icon"
            aria-label="Alternar menu"
            aria-expanded={drawer || !collapsed}
            onClick={toggle}
          >
            ☰
          </button>
          <label className="qg-global-search">
            <span className="auth-sr-only">Busca global — prevista</span>
            <input
              placeholder="Buscar rede, loja ou dispositivo…"
              disabled
              title="Busca global prevista; use os filtros de cada lista."
            />
          </label>
          <div className="qg-top-actions">
            <button
              className="qg-icon"
              aria-label={theme === "dark" ? "Tema claro" : "Tema escuro"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button
              className="qg-icon"
              aria-label="Alertas — previsto"
              disabled
            >
              ♧
            </button>
            <button
              ref={menuButton}
              className="qg-user"
              aria-label="Menu do usuário"
              aria-expanded={menu}
              aria-controls="qg-user-menu"
              onClick={() => setMenu((v) => !v)}
            >
              <span className="qg-avatar" aria-hidden="true">
                QG
              </span>
              <span>
                {support ? "Suporte" : "Administrador"}
                <small>da plataforma</small>
              </span>
              <span>⌄</span>
            </button>
            {menu && (
              <div id="qg-user-menu" className="qg-user-menu" ref={userMenu}>
                <button
                  onClick={() => {
                    setMenu(false);
                    actions?.onAccount();
                  }}
                >
                  Minha conta
                </button>
                <button
                  disabled={actions?.busy}
                  onClick={() => actions?.onLogout()}
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </header>
        <main id="qg-content" className="qg-content" data-theme={theme}>
          {actions && (
            <p className="auth-sr-only" role="status">
              Sessão autenticada.
            </p>
          )}
          {children}
        </main>
        <footer className="qg-footer">
          <a
            href="https://github.com/tomfonseca/crmf2026/tree/main/docs"
            target="_blank"
            rel="noreferrer"
          >
            Documentação
          </a>
          <span>© 2026 CRM Farma · QG · desenvolvimento</span>
        </footer>
      </div>
    </div>
  );
}
