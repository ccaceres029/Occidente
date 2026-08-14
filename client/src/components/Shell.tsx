import { type FormEvent, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ArrowRight,
  ClipboardList,
  FilePlus2,
  HelpCircle,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { HealthData } from '../types';
import { OccidenteMark } from './Brand';
import { Badge } from './ui';
import { spanishDynamicText } from '../utils';

const titles: Array<[RegExp, string, string]> = [
  [/^\/$/, 'Resumen operativo', 'Visión general de las afiliaciones'],
  [/^\/casos\/nuevo/, 'Nueva afiliación', 'Captura guiada y prevalidación'],
  [/^\/casos\/[^/]+/, 'Expediente 360', 'Análisis, decisión y trazabilidad'],
  [/^\/casos/, 'Bandeja de afiliaciones', 'Prioriza y gestiona los expedientes'],
  [/^\/politicas/, 'Políticas y reglas', 'Parametrización del motor de control'],
];

export default function Shell() {
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
          <NavLink to="/casos" end><ClipboardList size={19} /><span>Bandeja de casos</span>{queueTotal !== null && <kbd>{queueTotal}</kbd>}</NavLink>
          <NavLink to="/casos/nuevo"><FilePlus2 size={19} /><span>Nueva afiliación</span></NavLink>

          <span className="nav-group-label nav-group-label--spaced">Control</span>
          <NavLink to="/politicas"><ShieldCheck size={19} /><span>Políticas y reglas</span><em>Demo</em></NavLink>
        </nav>

        <div className="sidebar__bottom">
          <div className="sidebar__security">
            <ShieldCheck size={18} />
            <div><strong>Decisión supervisada</strong><span>La IA no aprueba casos</span></div>
          </div>
          <div className="user-card" aria-label="Usuario activo: Cinthia M., Afiliaciones, Usuario B">
            <span className="avatar">CM</span>
            <span><strong>Cinthia M.</strong><small>Afiliaciones · Usuario B</small></span>
          </div>
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
