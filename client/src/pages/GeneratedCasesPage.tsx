import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BrainCircuit, CalendarDays, CheckCircle2, CircleGauge, FileStack, FolderKanban, History, Mail, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Toast } from '../components/ui';
import type { AuthUser, GeneratedCaseSummary } from '../types';

function dateLabel(value: string, withTime = false): string {
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

const stageTone = (stage: GeneratedCaseSummary['workflow']['stage']) =>
  stage === 'ANALYSIS_ERROR' ? 'danger' : stage === 'DOCUMENT_INCOMPLETE' ? 'warning' : stage === 'DECISION_PENDING' ? 'purple' : 'success';

const riskTone = (level?: string) => level === 'ALTO' ? 'danger' : level === 'MEDIO' ? 'warning' : 'success';

export default function GeneratedCasesPage({ currentUser }: { currentUser: AuthUser }) {
  const [items, setItems] = useState<GeneratedCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<GeneratedCaseSummary | null>(null);
  const [confirmApproval, setConfirmApproval] = useState<GeneratedCaseSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'danger' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.generatedCases()).items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible consultar los casos generados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!items.some((item) => ['READY_FOR_ANALYSIS', 'ANALYZING'].includes(item.workflow.stage))) return;
    const timer = window.setInterval(() => void load(), 8_000);
    return () => window.clearInterval(timer);
  }, [items, load]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-HN');
    if (!term) return items;
    return items.filter((item) => [item.code, item.subject, item.senderName, item.senderEmail]
      .some((value) => value?.toLocaleLowerCase('es-HN').includes(term)));
  }, [items, search]);

  if (loading && !items.length) return <LoadingState label="Cargando casos generados…" />;
  if (error && !items.length) return <ErrorState message={error} onRetry={() => void load()} />;

  const documentTotal = items.reduce((sum, item) => sum + item.documentCount, 0);
  const decisionTotal = items.filter((item) => item.workflow.stage === 'DECISION_PENDING').length;

  const deleteCase = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const result = await api.deleteGeneratedCase(confirmDelete.id);
      setItems((current) => current.filter((item) => item.id !== confirmDelete.id));
      setToast({ message: `${result.code} y sus registros relacionados fueron eliminados.` });
      setConfirmDelete(null);
    } catch (deleteError) {
      setToast({
        message: deleteError instanceof Error ? deleteError.message : 'No fue posible eliminar el caso.',
        tone: 'danger',
      });
    } finally {
      setDeleting(false);
    }
  };

  const approveCase = async () => {
    if (!confirmApproval) return;
    setApproving(true);
    try {
      await api.finalizeGeneratedCase(confirmApproval.id);
      setItems((current) => current.filter((item) => item.id !== confirmApproval.id));
      setToast({ message: `${confirmApproval.code} fue aprobado y enviado a Casos finalizados.` });
      setConfirmApproval(null);
    } catch (approvalError) {
      setToast({
        message: approvalError instanceof Error ? approvalError.message : 'No fue posible aprobar el caso.',
        tone: 'danger',
      });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="generated-cases-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Ingesta documental</div>
          <h2>Casos Generados</h2>
          <p>Cada correo recibido se codifica y conserva con todos sus documentos adjuntos.</p>
        </div>
        <div className="page-lead__actions"><Badge tone="success" dot>{items.length} casos</Badge></div>
      </section>

      <section className="generated-summary" aria-label="Resumen de casos generados">
        <div><FolderKanban size={20} /><span><small>Casos creados</small><strong>{items.length}</strong></span></div>
        <div><FileStack size={20} /><span><small>Documentos en S3</small><strong>{documentTotal}</strong></span></div>
        <div><CalendarDays size={20} /><span><small>Última recepción</small><strong>{items[0] ? dateLabel(items[0].receivedAt) : 'Sin datos'}</strong></span></div>
        <div><BrainCircuit size={20} /><span><small>Decisión pendiente</small><strong>{decisionTotal}</strong></span></div>
      </section>

      <section className="generated-toolbar">
        <div className="search-field search-field--large"><Search size={18} /><input aria-label="Buscar casos generados" placeholder="Buscar por código, asunto o remitente…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <span>Almacenamiento privado · S3 / demo-occi</span>
      </section>

      {visible.length === 0 ? (
        <EmptyState icon={<FolderKanban size={26} />} title={items.length ? 'No hay coincidencias' : 'Aún no hay casos generados'} body={items.length ? 'Ajusta el término de búsqueda.' : 'Recibe los correos desde Solicitudes entrantes para iniciar la codificación.'} />
      ) : (
        <section className="generated-list" aria-busy={loading}>
          <header><span>Caso y solicitud</span><span>Remitente</span><span>Etapa</span><span>Riesgo</span><span>Recepción</span><span>Documentos</span><span /></header>
          {visible.map((item) => (
            <article key={item.id}>
              <div className="generated-list__case"><span><Mail size={18} /></span><div><strong>{item.code}</strong><p>{item.subject}</p></div></div>
              <div className="generated-list__sender"><strong>{item.senderName || 'Remitente'}</strong><small>{item.senderEmail || 'Sin dirección disponible'}</small></div>
              <Badge tone={stageTone(item.workflow.stage)}><BrainCircuit size={12} /> {item.workflow.label}</Badge>
              {item.risk ? <Badge tone={riskTone(item.risk.level)}><CircleGauge size={12} /> {item.risk.level} · {item.risk.score}</Badge> : <span className="generated-list__risk-empty">Sin evaluar</span>}
              <time dateTime={item.receivedAt}>{dateLabel(item.receivedAt, true)}</time>
              <Badge tone={item.documentAnalysis?.missingCount ? 'warning' : item.documentCount ? 'success' : 'neutral'}>
                <FileStack size={12} /> {item.documentCount}{item.documentAnalysis ? ` · ${item.documentAnalysis.completenessPercent}%` : ''}
              </Badge>
              <div className="generated-list__actions">
                {currentUser.role !== 'CONSULTA' && <button className="approve-case-button" type="button" onClick={() => setConfirmApproval(item)}><CheckCircle2 size={15} /> Apruebo</button>}
                <Link className="audit-case-link" to={`/casos-generados/${item.id}?view=audit`} title="Ver auditoría" aria-label={`Ver auditoría de ${item.code}`}><History size={15} /><span>Auditoría</span></Link>
                <Link to={`/casos-generados/${item.id}`} title="Abrir caso" aria-label={`Abrir ${item.code}`}><ArrowRight size={17} /></Link>
                {currentUser.role === 'ADMIN' && <button className="icon-button row-delete-button" type="button" title="Eliminar caso" aria-label={`Eliminar ${item.code}`} onClick={() => setConfirmDelete(item)}><Trash2 size={16} /></button>}
              </div>
            </article>
          ))}
        </section>
      )}
      <Modal open={Boolean(confirmApproval)} title="Aprobar y finalizar caso" description="Esta decisión humana moverá el expediente fuera de Casos generados." onClose={() => !approving && setConfirmApproval(null)}>
        {confirmApproval && <div className="case-approval-confirmation"><CheckCircle2 size={30} /><div><p>Confirmas que <strong>{confirmApproval.code}</strong> puede continuar y pasar a Casos finalizados.</p><small>La aprobación quedará registrada con tu usuario y la fecha actual.</small></div><footer><Button variant="ghost" onClick={() => setConfirmApproval(null)}>Cancelar</Button><Button variant="success" icon={<CheckCircle2 size={16} />} loading={approving} onClick={() => void approveCase()}>Sí, apruebo</Button></footer></div>}
      </Modal>
      <Modal open={Boolean(confirmDelete)} title="Eliminar caso en cascada" description="Esta acción es irreversible y está restringida a administradores." onClose={() => !deleting && setConfirmDelete(null)}>
        {confirmDelete && <div className="cascade-delete"><Trash2 size={28} /><div><p>Se eliminará <strong>{confirmDelete.code}</strong> junto con:</p><ul><li>El registro del correo recibido</li><li>Los {confirmDelete.documentCount} documentos relacionados</li><li>El control documental y el análisis integral</li><li>La carpeta completa del caso en S3</li></ul></div><footer><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button><Button variant="danger" loading={deleting} onClick={() => void deleteCase()}>Eliminar definitivamente</Button></footer></div>}
      </Modal>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
