import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Badge, Icon } from "@crmf/ui";
import { useFilters } from "./filters";
import { scenarios, stores, type Scenario } from "./demo/data";
const ThemeContext = createContext<"dark" | "light">("dark");
export const useTheme = () => useContext(ThemeContext);
function initialTheme(): "dark" | "light" {
  try {
    return localStorage.getItem("crmf-demo-theme") === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}
function Popup({
  label,
  close,
  children,
}: {
  label: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Node &&
        !ref.current?.parentElement?.contains(e.target)
      )
        close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [close]);
  return (
    <div ref={ref} className="popover" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
function InfoDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="info-dialog"
      aria-label={title}
      onCancel={close}
      onClose={close}
    >
      <div className="panel-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Fechar janela"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">
        {children}
        <button className="button button--primary" onClick={close}>
          Entendi
        </button>
      </div>
    </dialog>
  );
}
export function DashboardShell() {
  const { filters, update } = useFilters();
  const location = useLocation();
  const [theme, setTheme] = useState(initialTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [popup, setPopup] = useState<
    "stores" | "user" | "notifications" | null
  >(null);
  const [dialog, setDialog] = useState<
    "documentation" | "profile" | "exit" | null
  >(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closePopup = () => setPopup(null);
  const togglePopup = (name: typeof popup) =>
    setPopup(popup === name ? null : name);
  const storeName = stores.find((s) => s.id === filters.store)?.name;
  useEffect(() => {
    try {
      localStorage.setItem("crmf-demo-theme", theme);
    } catch {
      /* Storage can be disabled. */
    }
  }, [theme]);
  useEffect(() => {
    setMobileOpen(false);
    setSearch("");
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const trigger = document.activeElement;
    const items = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [],
      );
    items()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if (e.key === "Tab") {
        const controls = items();
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [mobileOpen]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !searchRef.current?.contains(e.target))
        setSearch("");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const pages = [
    {
      to: "/meu-desempenho",
      label: "Meu desempenho",
      menu: "Dashboard",
      icon: "dashboard",
    },
    {
      to: "/minhas-metas",
      label: "Minhas metas",
      menu: "Minhas metas",
      icon: "target",
    },
  ] as const;
  return (
    <ThemeContext.Provider value={theme}>
      <div className="dashboard" data-theme={theme} data-collapsed={collapsed}>
        <a className="skip-link" href="#main-content">
          Pular para o conteúdo
        </a>
        {mobileOpen && (
          <button
            className="sidebar-scrim"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          ref={sidebarRef}
          role={mobileOpen ? "dialog" : undefined}
          aria-modal={mobileOpen || undefined}
          className="sidebar"
          data-mobile-open={mobileOpen}
          aria-label="Barra lateral"
        >
          <Link
            to="/meu-desempenho"
            search={filters}
            className="brand"
            aria-label="CRM Farma — início"
          >
            <span className="brand-mark">C</span>
            <span className="sidebar-label brand-name">CRM Farma</span>
            <span className="sidebar-label">
              <Badge tone="accent">Loja</Badge>
            </span>
          </Link>
          <button
            className="icon-button sidebar-close"
            aria-label="Fechar navegação lateral"
            onClick={() => setMobileOpen(false)}
          >
            <Icon name="close" />
          </button>
          <nav className="main-nav" aria-label="Menu principal">
            <span className="sidebar-label nav-caption">Geral</span>
            {pages.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                search={filters}
                className={`nav-link ${location.pathname === page.to ? "is-active" : ""}`}
                aria-current={
                  location.pathname === page.to ? "page" : undefined
                }
                aria-label={page.menu}
                title={collapsed ? page.menu : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name={page.icon} />
                <span className="sidebar-label">{page.menu}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className="nav-link"
              onClick={() => setDialog("documentation")}
              aria-label="Documentação"
            >
              <Icon name="help" />
              <span className="sidebar-label">Documentação</span>
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <button
              className="icon-button desktop-menu"
              aria-label={
                collapsed ? "Expandir menu lateral" : "Recolher menu lateral"
              }
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Icon name="menu" />
            </button>
            <button
              className="icon-button mobile-menu"
              aria-label={mobileOpen ? "Fechar navegação" : "Abrir navegação"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Icon name="menu" />
            </button>
            <div className="shell-search" ref={searchRef}>
              <label className="sr-only" htmlFor="shell-search">
                Buscar páginas
              </label>
              <Icon name="search" size={16} />
              <input
                id="shell-search"
                type="search"
                placeholder="Buscar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearch("");
                }}
              />
              {search && (
                <div className="search-results">
                  {pages
                    .filter((p) =>
                      p.label
                        .toLocaleLowerCase("pt-BR")
                        .includes(search.toLocaleLowerCase("pt-BR")),
                    )
                    .map((p) => (
                      <Link
                        key={p.to}
                        to={p.to}
                        search={filters}
                        onClick={() => setSearch("")}
                      >
                        {p.label}
                      </Link>
                    ))}
                  {!pages.some((p) =>
                    p.label
                      .toLocaleLowerCase("pt-BR")
                      .includes(search.toLocaleLowerCase("pt-BR")),
                  ) && <p className="muted">Nenhuma página encontrada.</p>}
                </div>
              )}
            </div>
            <div className="header-actions">
              <button
                className="icon-button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={
                  theme === "dark" ? "Usar tema claro" : "Usar tema escuro"
                }
                title={
                  theme === "dark" ? "Usar tema claro" : "Usar tema escuro"
                }
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} />
              </button>
              <div className="popover-anchor">
                <button
                  className="icon-button notification-button"
                  aria-label="Notificações de demonstração"
                  aria-expanded={popup === "notifications"}
                  onClick={() => togglePopup("notifications")}
                >
                  <Icon name="bell" />
                  <span className="notification-dot" />
                </button>
                {popup === "notifications" && (
                  <Popup label="Notificações" close={closePopup}>
                    <div className="panel-heading">
                      <h2>Notificações</h2>
                      <Badge>Demonstração</Badge>
                    </div>
                    <div className="popover-body">
                      <p>Os dados desta sessão são fictícios.</p>
                      <p>Nenhum agente, ERP ou serviço está conectado.</p>
                    </div>
                  </Popup>
                )}
              </div>
              <div className="popover-anchor">
                <button
                  className="icon-button"
                  aria-label="Minhas lojas"
                  aria-expanded={popup === "stores"}
                  aria-controls="store-picker"
                  onClick={() => togglePopup("stores")}
                >
                  <Icon name="store" />
                </button>
                {popup === "stores" && (
                  <Popup label="Minhas lojas" close={closePopup}>
                    <div className="panel-heading">
                      <div>
                        <h2>Minhas lojas</h2>
                        <p>Troque de loja sem sair da sessão</p>
                      </div>
                    </div>
                    <div id="store-picker" className="store-grid">
                      {stores.map((store) => (
                        <button
                          key={store.id}
                          className={`store-tile ${filters.store === store.id ? "is-selected" : ""}`}
                          aria-pressed={filters.store === store.id}
                          onClick={() => {
                            update({ store: store.id });
                            closePopup();
                          }}
                        >
                          <span className="store-icon">
                            <Icon
                              name={store.id === "all" ? "dashboard" : "store"}
                              size={24}
                            />
                          </span>
                          <strong>{store.name}</strong>
                          <span>{store.description}</span>
                        </button>
                      ))}
                    </div>
                  </Popup>
                )}
              </div>
              <span className="header-divider" />
              <div className="popover-anchor">
                <button
                  className="user-button"
                  aria-label="Menu do usuário"
                  aria-expanded={popup === "user"}
                  onClick={() => togglePopup("user")}
                >
                  <span className="avatar">PE</span>
                  <span className="user-text">
                    <strong>Pericles</strong>
                    <span>{storeName}</span>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
                {popup === "user" && (
                  <Popup label="Menu do usuário" close={closePopup}>
                    <div className="user-options">
                      <button
                        onClick={() => {
                          closePopup();
                          setDialog("profile");
                        }}
                      >
                        Meu perfil
                      </button>
                      <button
                        onClick={() => {
                          closePopup();
                          setDialog("exit");
                        }}
                      >
                        Sair
                      </button>
                    </div>
                  </Popup>
                )}
              </div>
            </div>
          </header>
          <div className="demo-toolbar">
            <div>
              <Badge tone="accent">Demonstração</Badge>
              <span>
                Dados fictícios · referência: 25/11/2026 · sem conexão com ERP
              </span>
            </div>
            <label>
              Cenário
              <select
                aria-label="Cenário da demonstração"
                value={filters.scenario}
                onChange={(e) =>
                  update({ scenario: e.target.value as Scenario })
                }
              >
                {Object.entries(scenarios).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Outlet />
          <footer className="footer">
            <button
              className="text-button"
              onClick={() => setDialog("documentation")}
            >
              Documentação
            </button>
            <span>© 2026 CRM Farma · prévia visual</span>
          </footer>
        </div>
        {dialog && (
          <InfoDialog
            title={
              dialog === "documentation"
                ? "Sobre esta demonstração"
                : dialog === "profile"
                  ? "Perfil de demonstração"
                  : "Autenticação ainda não disponível"
            }
            close={() => setDialog(null)}
          >
            {dialog === "profile" ? (
              <>
                <p>
                  Pericles é um perfil fictício de colaborador para avaliação
                  visual.
                </p>
                <p>
                  Não há sessão autenticada, permissões ou dados pessoais reais.
                </p>
              </>
            ) : dialog === "exit" ? (
              <p>
                Esta é uma demonstração local sem login. Entrar e sair da conta
                serão implementados no M1.
              </p>
            ) : (
              <>
                <p>
                  Prévia de Meu desempenho e Minhas metas, baseada nos HTMLs
                  fornecidos. Filtros, gráficos e CSV usam apenas agregados
                  sintéticos locais.
                </p>
                <p>
                  “Clientes atendidos” representa cupons simulados, não pessoas
                  identificadas. CMV, fidelidade, metas e projeções são exemplos
                  de interface, não regras ERP validadas.
                </p>
                <p>
                  Comparativos mensais com a loja e metas por vendedor/grupo são
                  prévias de design. Não alteram as permissões ou as definições
                  vigentes na spec.
                </p>
                <p>
                  Nos exemplos, metas de períodos parciais são proporcionais aos
                  dias corridos. Sem denominador ou cobertura, mostramos “Sem
                  base”, nunca um percentual inventado.
                </p>
              </>
            )}
          </InfoDialog>
        )}
      </div>
    </ThemeContext.Provider>
  );
}
