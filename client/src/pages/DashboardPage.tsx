import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FilePlus2,
  FileStack,
  FolderKanban,
  Inbox,
  Mail,
  RefreshCw,
  RotateCcw,
  RotateCwSquare,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import { api } from '../api';
import type { AuthUser, DashboardData } from '../types';
import { CaseCard } from '../components/CaseCard';
import { Badge, Button, ErrorState, LoadingState, Toast } from '../components/ui';
import { spanishDynamicText, titleFromStatus } from '../utils';

type KpiProps = {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone?: string;
};

function KpiCard({ label, value, detail, icon, tone = 'green' }: KpiProps) {
  return (
    <article className={`kpi-card kpi-card--${tone}`}>
      <div className="kpi-card__top"><span>{label}</span><i>{icon}</i></div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function VolumeChart({ data }: { data: Array<{ label: string; count: number }> }) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="bar-chart" role="img" aria-label="Volumen de expedientes">
      <div className="bar-chart__grid"><span /><span /><span /><span /></div>
      <div className="bar-chart__bars">
        {data.map((item, index) => (
          <div className="bar-chart__column" key={`${item.label}-${index}`}>
            <span className="bar-chart__value">{item.count}</span>
            <div className="bar-chart__bar-wrap">
              <div className="bar-chart__bar" style={{ height: `${Math.max(8, (item.count / max) * 100)}%` }} />
            </div>
            <span className="bar-chart__label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function activityDate(value: string): string {
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

export default function DashboardPage({ currentUser }: { currentUser: AuthUser }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.dashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetDemoData = async () => {
    const confirmed = window.confirm('Esto restaurará los datos predefinidos y eliminará los casos de prueba creados en esta sesión. ¿Deseas continuar?');
    if (!confirmed) return;
    setResetting(true);
    setError('');
    try {
      const response = await api.resetDemoData();
      setData(response.dashboard);
      setToast({ message: response.message || 'Datos predefinidos restaurados.', tone: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No fue posible reiniciar los datos.', tone: 'danger' });
    } finally {
      setResetting(false);
    }
  };

  const volumeData = useMemo(() => {
    if (!data) return [];
    if (data.volumeByDay?.length) {
      return data.volumeByDay.map((item) => ({ label: spanishDynamicText(item.label || item.date.slice(5)), count: item.count }));
    }
    return data.byStatus.map((item) => ({ label: titleFromStatus(item.status, spanishDynamicText(item.label)), count: item.count }));
  }, [data]);

  if (loading && !data) return <LoadingState label="Preparando el resumen operativo…" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return null;

  const metrics = data.metrics;
  const mailIntake = data.source === 'mail-intake';
  const operationalLink = mailIntake ? '/casos-generados' : '/casos';
  const totalStatus = Math.max(data.byStatus.reduce((sum, item) => sum + item.count, 0), 1);
  const todayLabel = new Intl.DateTimeFormat('es-HN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: 'America/Tegucigalpa',
  }).format(new Date());

  return (
    <div className="dashboard-page">
      <section className="page-lead">
        <div>
          <div className="eyebrow"><span /> {todayLabel}</div>
          <h2>Buenos días, {currentUser.displayName}</h2>
          {mailIntake
            ? <p>Se han recibido <strong>{metrics.incomingTotal ?? 0} solicitudes</strong> y generado {metrics.generatedTotal ?? 0} casos desde el buzón conectado.</p>
            : <p>Tienes <strong>{metrics.inReview} expedientes en revisión</strong> y {metrics.compliance} requieren seguimiento de Cumplimiento.</p>}
        </div>
        <div className="page-lead__actions">
          {!mailIntake && <Button variant="ghost" icon={<RotateCwSquare size={17} />} onClick={() => void resetDemoData()} loading={resetting}>Reiniciar datos</Button>}
          <Button variant="secondary" icon={<RefreshCw size={17} />} onClick={() => void load()} loading={loading}>Actualizar</Button>
          {mailIntake
            ? <Link className="button button--primary" to="/solicitudes"><Inbox size={17} /><span>Ver solicitudes</span></Link>
            : <Link className="button button--primary" to="/casos/nuevo"><FilePlus2 size={17} /><span>Nueva afiliación</span></Link>}
        </div>
      </section>

      <section className="kpi-grid" aria-label="Indicadores principales">
        {mailIntake ? <>
          <KpiCard label="Solicitudes recibidas" value={metrics.incomingTotal ?? 0} detail={`${metrics.pendingGeneration ?? 0} pendientes de generar`} icon={<Inbox size={20} />} />
          <KpiCard label="Casos generados" value={metrics.generatedTotal ?? 0} detail="Creados desde el buzón" icon={<FolderKanban size={20} />} tone="emerald" />
          <KpiCard label="Documentos recibidos" value={metrics.documentTotal ?? 0} detail="Conservados en S3 privado" icon={<FileStack size={20} />} tone="blue" />
          <KpiCard label="Control pendiente" value={metrics.incomplete ?? 0} detail="Documentación incompleta" icon={<RotateCcw size={20} />} tone="orange" />
          <KpiCard label="Decisión pendiente" value={metrics.decisionPending ?? 0} detail={`${metrics.analyzing ?? 0} en análisis`} icon={<BrainCircuit size={20} />} tone="purple" />
        </> : <>
          <KpiCard label="Expedientes activos" value={metrics.total} detail="En todas las etapas" icon={<FolderKanban size={20} />} />
          <KpiCard label="Listos para sistema central" value={metrics.readyForCore} detail="Con validaciones completas" icon={<CheckCircle2 size={20} />} tone="emerald" />
          <KpiCard label="Tasa de reproceso" value={`${metrics.reprocessRate}%`} detail="Casos devueltos a agencia" icon={<RotateCcw size={20} />} tone="orange" />
          <KpiCard label="Tiempo promedio" value={`${metrics.avgCycleHours} h`} detail="Desde recepción a decisión" icon={<Clock3 size={20} />} tone="blue" />
          <KpiCard label="Ahorro estimado" value={`${metrics.estimatedHoursSaved} h`} detail="Calculado desde documentos y campos cargados" icon={<TrendingDown size={20} />} tone="purple" />
        </>}
      </section>

      <div className="dashboard-grid">
        <section className="panel panel--volume">
          <header className="panel__header">
            <div><h3>{mailIntake ? 'Solicitudes recibidas' : 'Volumen de expedientes'}</h3><p>{mailIntake ? 'Correos incorporados desde la bandeja de SiteGround' : data.volumeByDay?.length ? 'Casos creados desde las pruebas del portal' : 'Distribución actual por etapa'}</p></div>
            <Badge tone="neutral">{data.volumeByDay?.length ? `Últimos ${data.volumeByDay.length} días` : 'Estado actual'}</Badge>
          </header>
          <VolumeChart data={volumeData} />
        </section>

        <section className="panel panel--alerts">
          <header className="panel__header">
            <div><h3>Atención requerida</h3><p>Alertas priorizadas por el motor de reglas</p></div>
            <span className="panel__icon panel__icon--orange"><AlertTriangle size={19} /></span>
          </header>
          <div className="alert-list">
            {data.alerts.map((alert, index) => (
              <Link to={operationalLink} className={`alert-row alert-row--${alert.level}`} key={`${alert.message}-${index}`}>
                <span className="alert-row__count">{alert.count}</span>
                <div><strong>{spanishDynamicText(alert.message)}</strong><small>Requiere revisión humana</small></div>
                <ArrowRight size={17} />
              </Link>
            ))}
          </div>
          <Link to={operationalLink} className="panel-link">Ver bandeja priorizada <ArrowRight size={16} /></Link>
        </section>
      </div>

      <section className="panel workflow-panel">
        <header className="panel__header">
          <div><h3>{mailIntake ? 'Flujo de casos generados' : 'Flujo de afiliación'}</h3><p>{mailIntake ? 'Etapa actual desde control documental hasta decisión' : 'Distribución de los casos activos'}</p></div>
          <Badge tone="success" dot>Actualizado en tiempo real</Badge>
        </header>
        <div className="workflow-strip">
          {data.byStatus.map((item, index) => (
            <div className="workflow-step" key={item.status}>
              <div className="workflow-step__head"><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.count}</strong></div>
              <h4>{titleFromStatus(item.status, spanishDynamicText(item.label))}</h4>
              <div className="workflow-step__track"><i style={{ width: `${Math.max(7, (item.count / totalStatus) * 100)}%` }} /></div>
              {index < data.byStatus.length - 1 && <ArrowRight className="workflow-step__arrow" size={17} />}
            </div>
          ))}
        </div>
      </section>

      {mailIntake ? (
        <div className="dashboard-activity-grid">
          <section className="panel recent-panel">
            <header className="panel__header">
              <div><h3>Solicitudes recientes</h3><p>Últimos correos incorporados</p></div>
              <Link to="/solicitudes" className="panel-link">Ver todas <ArrowRight size={16} /></Link>
            </header>
            <div className="dashboard-mail-list">
              {(data.recentIncoming ?? []).map((item) => (
                <Link to={item.caseId ? `/casos-generados/${item.caseId}` : '/solicitudes'} key={item.id}>
                  <span className="dashboard-mail-list__icon"><Mail size={17} /></span>
                  <span><strong>{item.subject}</strong><small>{item.senderName || item.senderEmail || 'Remitente'} · {activityDate(item.receivedAt)}</small></span>
                  <ArrowRight size={16} />
                </Link>
              ))}
              {(data.recentIncoming ?? []).length === 0 && <p className="dashboard-activity-empty">No hay solicitudes recibidas.</p>}
            </div>
          </section>

          <section className="panel recent-panel">
            <header className="panel__header">
              <div><h3>Casos generados recientes</h3><p>Actividad creada desde solicitudes</p></div>
              <Link to="/casos-generados" className="panel-link">Ver todos <ArrowRight size={16} /></Link>
            </header>
            <div className="dashboard-mail-list">
              {(data.recentGeneratedCases ?? []).map((item) => (
                <Link to={`/casos-generados/${item.id}`} key={item.id}>
                  <span className="dashboard-mail-list__icon dashboard-mail-list__icon--case"><FolderKanban size={17} /></span>
                  <span><strong>{item.code}</strong><small>{item.workflow.label} · {item.documentCount} documento(s)</small></span>
                  <ArrowRight size={16} />
                </Link>
              ))}
              {(data.recentGeneratedCases ?? []).length === 0 && <p className="dashboard-activity-empty">No hay casos generados.</p>}
            </div>
          </section>
        </div>
      ) : (
        <section className="panel recent-panel">
          <header className="panel__header">
            <div><h3>Expedientes recientes</h3><p>Últimos movimientos en la mesa de control</p></div>
            <Link to="/casos" className="panel-link">Ver todos <ArrowRight size={16} /></Link>
          </header>
          <div className="recent-list">
            {data.recentCases.slice(0, 4).map((item) => <CaseCard item={item} compact key={item.id} />)}
          </div>
        </section>
      )}

      <aside className="ai-safety-note">
        <div className="ai-safety-note__icon"><Sparkles size={21} /></div>
        <div><strong>Asistencia inteligente con control humano</strong><p>La IA resume y detecta inconsistencias; las reglas críticas son determinísticas y la decisión final siempre pertenece a un usuario autorizado.</p></div>
        <div className="ai-safety-note__badges"><Badge tone="success"><ShieldCheck size={13} /> Trazable</Badge><Badge tone="info"><CircleDollarSign size={13} /> Datos sintéticos</Badge></div>
        <div className="ai-safety-note__actions">
          <Link className="ai-safety-note__link" to="/casos/case-001?tab=ai">Ver análisis IA <ArrowRight size={15} /></Link>
          <Link className="ai-safety-note__link ai-safety-note__link--secondary" to="/casos/case-002?tab=ai">Comparar Cumplimiento</Link>
        </div>
      </aside>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
