import { type FormEvent, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ArrowRight,
  ClipboardList,
  Inbox,
  FilePlus2,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  Menu,
  LogOut,
  Mail,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { HealthData } from '../types';
import type { AuthUser } from '../types';
import { OccidenteMark } from './Brand';
import { Badge } from './ui';
import { spanishDynamicText } from '../utils';
import { APP_VERSION } from '../version';

const titles: Array<[RegExp, string, string]> = [
  [/^\/$/, 'Resumen operativo', 'Visión general de las afiliaciones'],
  [/^\/casos-generados\/[^/]+/, 'Caso generado', 'Correo recibido y documentos almacenados'],
  [/^\/casos-generados/, 'Casos generados', 'Solicitudes codificadas desde el correo'],
  [/^\/casos\/nuevo/, 'Nueva afiliación', 'Captura guiada y prevalidación'],
  [/^\/casos\/[^/]+/, 'Expediente 360', 'Análisis, decisión y trazabilidad'],
  [/^\/casos/, 'Bandeja de afiliaciones', 'Prioriza y gestiona los expedientes'],
  [/^\/politicas/, 'Políticas y reglas', 'Parametrización del motor de control'],
  [/^\/solicitudes/, 'Solicitudes entrantes', 'Correos recibidos para iniciar el proceso'],
  [/^\/configuracion\/correo/, 'Configuración de correo', 'Conexiones IMAP y SMTP del portal'],
  [/^\/configuracion\/usuarios/, 'Administración de usuarios', 'Accesos, roles y estado de las cuentas'],
];

export default function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [queueTotal, setQueueTotal] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<Array<{ level: string; message: string; count: number }>>([]);
  const [globalSearch, setGlobalSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const title = titles.find(([pattern]) => pattern.test(location.pathname)) || titles[0];

  useEffect(() => {
    let active = true;
    api.health().then((data) => active && setHealth(data)).catch(() => active && setHealth(null));
    api.dashboard().then((data) => {
      if (active) {
        setQueueTotal(data.metrics.total);
        setAlerts(data.alerts);
      }
    }).catch(() => active && setQueueTotal(null));
    return () => { active = false; };
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = globalSearch.trim();
    navigate(term ? `/casos?search=${encodeURIComponent(term)}` : '/casos');
  };
  const initials = user.displayName.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const logout = async () => {
    try { await api.logout(); } finally { onLogout(); }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand-row">
          <OccidenteMark />
          <button className="icon-button sidebar__close" type="button" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú">
            <X size={20} />
          </button>
        </div>

        <div className="demo-label">
          <span className="demo-label__pulse" />
          Entorno de demostración · datos sintéticos
        </div>

        <nav className="sidebar__nav" aria-label="Navegación principal">
          <span className="nav-group-label">Operación</span>
          <NavLink to="/" end><LayoutDashboard size={19} /><span>Resumen operativo</span></NavLink>
          <NavLink to="/solicitudes"><Inbox size={19} /><span>Solicitudes entrantes</span></NavLink>
          <NavLink to="/casos-generados"><FolderKanban size={19} /><span>Casos generados</span></NavLink>

          <span className="nav-group-label nav-group-label--spaced">Control</span>
          <NavLink to="/politicas"><ShieldCheck size={19} /><span>Políticas y reglas</span><em>Demo</em></NavLink>

          <span className="nav-group-label nav-group-label--spaced">Configuración</span>
          <NavLink to="/configuracion/correo"><Mail size={19} /><span>Correo IMAP / SMTP</span></NavLink>
          <NavLink to="/casos" end><ClipboardList size={19} /><span>Bandeja de casos</span>{queueTotal !== null && <kbd>{queueTotal}</kbd>}</NavLink>
          <NavLink to="/casos/nuevo"><FilePlus2 size={19} /><span>Nueva afiliación</span></NavLink>
          {user.role === 'ADMIN' && <NavLink to="/configuracion/usuarios"><Users size={19} /><span>Usuarios</span></NavLink>}
        </nav>

        <div className="sidebar__bottom">
          <div className="sidebar__security">
            <ShieldCheck size={18} />
            <div><strong>Decisión supervisada</strong><span>La IA no aprueba casos</span></div>
          </div>
          <div className="user-card" aria-label={`Usuario activo: ${user.displayName}`}>
            <span className="avatar">{initials || 'U'}</span>
            <span><strong>{user.displayName}</strong><small>{user.role}</small></span>
            <button type="button" onClick={() => void logout()} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={16} /></button>
          </div>
          <span className="portal-version">Portal v{APP_VERSION}</span>
        </div>
      </aside>

      {menuOpen && <button className="sidebar-scrim" type="button" onClick={() => setMenuOpen(false)} aria-label="Cerrar navegación" />}

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar__title">
            <button className="icon-button topbar__menu" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menú">
              <Menu size={21} />
            </button>
            <div>
              <h1>{title[1]}</h1>
              <p>{title[2]}</p>
            </div>
          </div>
          <div className="topbar__actions">
            <form className="global-search" onSubmit={submitSearch}>
              <Search size={17} aria-hidden="true" />
              <input ref={searchRef} aria-label="Buscar globalmente" placeholder="Buscar caso, cliente…" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} />
              <span>⌘ K</span>
              <button type="submit" aria-label="Ejecutar búsqueda"><ArrowRight size={15} /></button>
            </form>
            <Badge tone={health?.status === 'ok' ? 'success' : 'neutral'} dot>
              {health?.status === 'ok' ? 'Servicio conectado' : 'Conectando…'}
            </Badge>
            <div className="topbar-popover-wrap">
              <button className="icon-button" type="button" aria-label="Ayuda" aria-expanded={helpOpen} onClick={() => { setHelpOpen((open) => !open); setNotificationsOpen(false); }}><HelpCircle size={20} /></button>
              {helpOpen && <div className="topbar-popover topbar-popover--help"><strong>Guía rápida de la demostración</strong><p>Inicia en la bandeja, abre un expediente y recorre documentos, reglas y decisiones. Toda la información es sintética.</p><NavLink to="/casos/nuevo" onClick={() => setHelpOpen(false)}>Crear caso de prueba</NavLink></div>}
            </div>
            <div className="topbar-popover-wrap">
              <button className="icon-button icon-button--notified" type="button" aria-label="Notificaciones" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setHelpOpen(false); }}><Bell size={20} />{alerts.length > 0 && <i />}</button>
              {notificationsOpen && <div className="topbar-popover"><header><strong>Alertas operativas</strong><Badge tone="neutral">{alerts.reduce((sum, alert) => sum + alert.count, 0)}</Badge></header>{alerts.slice(0, 3).map((alert) => <div className="topbar-alert" key={alert.message}><span>{alert.count}</span><p>{spanishDynamicText(alert.message)}</p></div>)}<NavLink to="/casos" onClick={() => setNotificationsOpen(false)}>Abrir bandeja</NavLink></div>}
            </div>
          </div>
        </header>

        <div className="page-content">
          <Outlet context={{ health }} />
        </div>
      </main>
    </div>
  );
}
