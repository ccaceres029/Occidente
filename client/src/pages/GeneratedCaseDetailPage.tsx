import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, BrainCircuit, Check, CheckCircle2, Clock3, Database, Download, Eye, File, FileStack, Globe2, HardDrive, History, Mail, MailCheck, RefreshCw, ShieldCheck, Sparkles, Trash2, UserRound } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import GeneratedCaseIntelligencePanel from '../components/GeneratedCaseIntelligencePanel';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Toast } from '../components/ui';
import type { AuthUser, GeneratedCaseDetail, GeneratedCaseDocument } from '../types';

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function previewable(document: GeneratedCaseDocument): boolean {
  return document.contentType === 'application/pdf' || document.contentType.startsWith('image/') || document.contentType.startsWith('text/');
}

function orderDocuments(detail: GeneratedCaseDetail): GeneratedCaseDetail {
  return {
    ...detail,
    documents: [...detail.documents].sort((left, right) =>
      left.filename.localeCompare(right.filename, 'es-HN', { numeric: true, sensitivity: 'base' })),
  };
}

const auditStatusLabel = {
  COMPLETED: 'Completado',
  PENDING: 'En curso',
  ERROR: 'Incidencia',
  INFO: 'Informativo',
} as const;

const auditActorLabel = {
  PERSON: 'Usuario',
  SYSTEM: 'Sistema',
  EXTERNAL: 'Externo',
  AI: 'IA',
} as const;

export default function GeneratedCaseDetailPage({ currentUser }: { currentUser: AuthUser }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [detail, setDetail] = useState<GeneratedCaseDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmApproval, setConfirmApproval] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeView, setActiveView] = useState<'documents' | 'analysis' | 'audit'>(
    searchParams.get('view') === 'audit' ? 'audit' : 'documents',
  );
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.generatedCase(id)
      .then(({ case: generated }) => {
        if (!active) return;
        const ordered = orderDocuments(generated);
        setDetail(ordered);
        setSelectedId(ordered.documents[0]?.id || '');
        if (generated.documentAnalysis?.status === 'COMPLETE' || generated.intelligenceStatus?.status === 'ERROR') {
          setActiveView((current) => current === 'audit' ? current : 'analysis');
        }
      })
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar el caso.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!detail || detail.documentAnalysis?.status !== 'COMPLETE' || detail.intelligenceStatus?.status === 'COMPLETE' || detail.intelligenceStatus?.status === 'ERROR') return;
    const timer = window.setInterval(() => {
      api.generatedCase(id).then(({ case: generated }) => {
        setDetail(orderDocuments(generated));
        if (generated.documentIntelligence || generated.intelligenceStatus?.status === 'ERROR') {
          setActiveView((current) => current === 'audit' ? current : 'analysis');
        }
      }).catch(() => undefined);
    }, 3_500);
    return () => window.clearInterval(timer);
  }, [detail, id]);

  const selected = useMemo(() => detail?.documents.find((document) => document.id === selectedId), [detail, selectedId]);
  const selectedUrl = selected && detail ? api.generatedDocumentUrl(detail.id, selected.id) : '';

  const deleteCase = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      const result = await api.deleteGeneratedCase(detail.id);
      navigate('/casos-generados', { replace: true, state: { deleted: result.code } });
    } catch (deleteError) {
      setToast({ message: deleteError instanceof Error ? deleteError.message : 'No fue posible eliminar el caso.', tone: 'danger' });
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const analyzeCase = async () => {
    if (!detail) return;
    setAnalyzing(true);
    try {
      const result = await api.analyzeGeneratedCase(detail.id);
      setDetail(orderDocuments(result.case));
      if (result.case.documentAnalysis?.status === 'COMPLETE' || result.case.intelligenceStatus?.status === 'ERROR') setActiveView('analysis');
      setToast({ message: result.case.documentIntelligence ? 'Análisis integral del expediente actualizado.' : result.case.documentAnalysis?.status === 'COMPLETE' ? 'Análisis integral iniciado; el resultado aparecerá automáticamente.' : 'Control de recepción documental actualizado.', tone: 'success' });
    } catch (analysisError) {
      setToast({ message: analysisError instanceof Error ? analysisError.message : 'No fue posible actualizar el análisis.', tone: 'danger' });
    } finally {
      setAnalyzing(false);
    }
  };

  const approveCase = async () => {
    if (!detail) return;
    setApproving(true);
    try {
      await api.finalizeGeneratedCase(detail.id);
      navigate('/casos-finalizados', { replace: true, state: { finalized: detail.code } });
    } catch (approvalError) {
      setToast({ message: approvalError instanceof Error ? approvalError.message : 'No fue posible aprobar el caso.', tone: 'danger' });
      setConfirmApproval(false);
    } finally {
      setApproving(false);
    }
  };

  if (loading) return <LoadingState label="Cargando caso generado…" />;
  if (error || !detail) return <ErrorState message={error || 'No se encontró el caso generado.'} />;

  return (
    <div className="generated-detail-page">
      <section className="page-lead page-lead--compact">
        <div>
          <Link className="back-link" to="/casos-generados"><ArrowLeft size={15} /> Casos generados</Link>
          <div className="eyebrow"><span /> Caso recibido</div>
          <h2>{detail.code}</h2>
          <p>{detail.subject}</p>
        </div>
        <div className="page-lead__actions">
          <Badge tone={detail.workflow.stage === 'ANALYSIS_ERROR' ? 'danger' : detail.workflow.stage === 'DOCUMENT_INCOMPLETE' ? 'warning' : 'success'} dot>{detail.workflow.label}</Badge>
          {currentUser.role !== 'CONSULTA' && detail.workflow.stage !== 'FINALIZED' && <Button variant="success" icon={<CheckCircle2 size={16} />} onClick={() => setConfirmApproval(true)}>Apruebo</Button>}
          {currentUser.role === 'ADMIN' && <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setConfirmDelete(true)}>Eliminar caso</Button>}
        </div>
      </section>

      <section className="generated-case-steps" aria-label="Etapas del caso">
        {[
          { key: 'DOCUMENT', label: 'Control documental', detail: detail.documentAnalysis?.missingCount ? `${detail.documentAnalysis.completenessPercent}% recibido` : 'Paquete completo' },
          { key: 'ANALYSIS', label: 'Análisis del expediente', detail: detail.workflow.stage === 'ANALYZING' ? 'En ejecución' : detail.documentIntelligence ? 'Resultado disponible' : 'Pendiente' },
          { key: 'DECISION', label: 'Decisión humana', detail: detail.workflow.stage === 'FINALIZED' ? 'Aprobado' : detail.workflow.stage === 'DECISION_PENDING' ? 'Acción requerida' : 'Pendiente' },
          { key: 'FINALIZED', label: 'Caso finalizado', detail: detail.finalizedBy ? `Aprobado por ${detail.finalizedBy}` : 'Pendiente' },
        ].map((step, index) => {
          const current = detail.workflow.stage === 'DOCUMENT_INCOMPLETE' ? 0 : ['READY_FOR_ANALYSIS', 'ANALYZING', 'ANALYSIS_ERROR'].includes(detail.workflow.stage) ? 1 : detail.workflow.stage === 'FINALIZED' ? 3 : 2;
          return <div className={index < current ? 'is-complete' : index === current ? 'is-current' : ''} key={step.key}><span>{index < current ? <Check size={15} /> : index + 1}</span><p><strong>{step.label}</strong><small>{step.detail}</small></p>{index < 3 && <i />}</div>;
        })}
      </section>

      <section className="generated-detail-meta">
        <div><Mail size={18} /><span><small>Remitente</small><strong>{detail.senderName || detail.senderEmail || 'No identificado'}</strong><em>{detail.senderEmail}</em></span></div>
        <div><FileStack size={18} /><span><small>Documentos adjuntos</small><strong>{detail.documentCount}</strong><em>Relacionados al correo original</em></span></div>
        <div><HardDrive size={18} /><span><small>Almacenamiento</small><strong>S3 privado</strong><em>demo-occi/{detail.code}/</em></span></div>
        <div><ShieldCheck size={18} /><span><small>Recepción</small><strong>{dateLabel(detail.receivedAt)}</strong><em>Trazabilidad desde IMAP</em></span></div>
      </section>

      {detail.documentAnalysis && (
        <section className={`document-completeness ${detail.documentAnalysis.missingCount ? 'has-missing' : 'is-complete'}`}>
          <div className="document-completeness__score">
            <span><Sparkles size={18} /></span>
            <div><small>Análisis de recepción</small><strong>{detail.documentAnalysis.completenessPercent}%</strong><em>{detail.documentAnalysis.receivedCount} de {detail.documentAnalysis.expectedCount} requeridos</em></div>
          </div>
          <div className="document-completeness__result">
            <header>
              <Badge tone={detail.documentAnalysis.missingCount ? 'warning' : 'success'}>
                {detail.documentAnalysis.missingCount ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                {detail.documentAnalysis.missingCount ? `${detail.documentAnalysis.missingCount} pendiente(s)` : 'Paquete completo'}
              </Badge>
              <span>{detail.documentAnalysis.provider === 'gemini' ? `Gemini · ${detail.documentAnalysis.model || 'activo'}` : 'Motor documental'}</span>
            </header>
            <div className="document-completeness__progress"><span style={{ width: `${detail.documentAnalysis.completenessPercent}%` }} /></div>
            <p>{detail.documentAnalysis.summary}</p>
            <div className="document-completeness__matrix">
              {detail.documentAnalysis.items.map((item) => (
                <span className={item.status === 'PRESENT' ? 'is-present' : 'is-missing'} key={item.requirementType} title={item.reason}>
                  {item.status === 'PRESENT' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{item.label}
                </span>
              ))}
            </div>
          </div>
          <div className="document-completeness__action">
            <Button variant="ghost" icon={<RefreshCw size={15} />} loading={analyzing} onClick={() => void analyzeCase()}>Analizar de nuevo</Button>
            {detail.missingDocumentRequest?.status === 'SENT' ? (
              <span className="document-completeness__mail-status" title={detail.missingDocumentRequest.subject}>
                <MailCheck size={13} /> Solicitud enviada{detail.missingDocumentRequest.sentAt ? ` · ${dateLabel(detail.missingDocumentRequest.sentAt)}` : ''}
              </span>
            ) : detail.missingDocumentRequest?.status === 'ERROR' ? (
              <span className="document-completeness__mail-status is-error" title={detail.missingDocumentRequest.error}>
                <AlertTriangle size={13} /> Error al enviar correo
              </span>
            ) : <small>Control de presencia; no valida contenido ni autenticidad.</small>}
          </div>
        </section>
      )}

      <nav className="generated-case-tabs" aria-label="Contenido del caso">
        <button type="button" className={activeView === 'documents' ? 'is-active' : ''} onClick={() => setActiveView('documents')}><FileStack size={16} /> Documentos <span>{detail.documents.length}</span></button>
        <button type="button" className={activeView === 'analysis' ? 'is-active' : ''} onClick={() => setActiveView('analysis')}><BrainCircuit size={16} /> Análisis integral {detail.documentIntelligence && <CheckCircle2 size={14} />}</button>
        <button type="button" className={activeView === 'audit' ? 'is-active' : ''} onClick={() => setActiveView('audit')}><History size={16} /> Auditoría <span>{detail.auditTrail.length}</span></button>
      </nav>

      {activeView === 'documents' && (detail.documents.length ? (
        <div className="generated-document-workspace">
          <aside className="generated-document-list">
            <header><FileStack size={17} /><div><strong>Documentos</strong><small>{detail.documents.length} archivo(s)</small></div></header>
            {detail.documents.map((document) => (
              <button type="button" className={document.id === selectedId ? 'is-active' : ''} key={document.id} onClick={() => setSelectedId(document.id)}>
                <span><File size={17} /></span><div><strong>{document.filename}</strong><small>{sizeLabel(document.sizeBytes)} · {document.contentType}</small></div>
              </button>
            ))}
          </aside>
          <section className="generated-document-viewer">
            {selected && <>
              <header><div><Eye size={18} /><span><strong>{selected.filename}</strong><small>{sizeLabel(selected.sizeBytes)} · Integridad SHA-256 verificada</small></span></div><a href={selectedUrl} target="_blank" rel="noreferrer"><Download size={15} /> Abrir documento</a></header>
              <div className="generated-document-frame">
                {previewable(selected)
                  ? <iframe key={selected.id} src={selectedUrl} title={`Vista previa de ${selected.filename}`} />
                  : <EmptyState icon={<File size={26} />} title="Vista previa no disponible" body="Este formato puede abrirse o descargarse desde el botón superior." />}
              </div>
            </>}
          </section>
        </div>
      ) : <EmptyState icon={<FileStack size={26} />} title="Caso sin documentos adjuntos" body="El correo fue codificado correctamente, pero no contenía archivos adjuntos." />)}

      {activeView === 'analysis' && <GeneratedCaseIntelligencePanel detail={detail} analyzing={analyzing} onAnalyze={() => void analyzeCase()} />}

      {activeView === 'audit' && (
        <section className="generated-audit-panel" aria-label={`Auditoría de ${detail.code}`}>
          <header>
            <div><History size={22} /><span><small>Trazabilidad integral</small><h3>Historial de auditoría del caso</h3><p>Registro cronológico desde la recepción del correo hasta la etapa actual.</p></span></div>
            <Badge tone="neutral">{detail.auditTrail.length} eventos</Badge>
          </header>
          <div className="generated-audit-summary">
            <div><Clock3 size={18} /><span><small>Inicio del expediente</small><strong>{dateLabel(detail.auditTrail[0]?.createdAt || detail.receivedAt)}</strong></span></div>
            <div><UserRound size={18} /><span><small>Responsable actual</small><strong>{detail.finalizedBy || 'Automatización operativa'}</strong></span></div>
            <div><Database size={18} /><span><small>Evidencias vinculadas</small><strong>{detail.documents.length} documentos</strong></span></div>
          </div>
          <div className="audit-timeline generated-audit-timeline">
            {detail.auditTrail.map((event, index) => (
              <article key={event.id}>
                <div className={`audit-timeline__rail is-${event.actorType.toLocaleLowerCase('en-US')}`}>
                  <span>{event.actorType === 'PERSON' ? <UserRound size={15} /> : event.actorType === 'EXTERNAL' ? <Globe2 size={15} /> : event.actorType === 'AI' ? <Bot size={15} /> : <Database size={15} />}</span>
                  {index < detail.auditTrail.length - 1 && <i />}
                </div>
                <div className="audit-timeline__content">
                  <header><strong>{event.label}</strong><time dateTime={event.createdAt}>{dateLabel(event.createdAt)}</time></header>
                  <p>{event.detail}</p>
                  <footer>
                    <span className="avatar avatar--small">{event.actor.slice(0, 1).toUpperCase()}</span>
                    <strong>{event.actor}</strong>
                    <Badge tone="neutral">{auditActorLabel[event.actorType]}</Badge>
                    <Badge tone={event.status === 'ERROR' ? 'danger' : event.status === 'PENDING' ? 'warning' : event.status === 'COMPLETED' ? 'success' : 'neutral'}>{auditStatusLabel[event.status]}</Badge>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <Modal open={confirmApproval} title="Aprobar y finalizar caso" description="Esta decisión humana moverá el expediente a Casos finalizados." onClose={() => !approving && setConfirmApproval(false)}>
        <div className="case-approval-confirmation"><CheckCircle2 size={30} /><div><p>Confirmas que <strong>{detail.code}</strong> puede continuar.</p><small>La aprobación quedará registrada con tu usuario y la fecha actual.</small></div><footer><Button variant="ghost" onClick={() => setConfirmApproval(false)}>Cancelar</Button><Button variant="success" icon={<CheckCircle2 size={16} />} loading={approving} onClick={() => void approveCase()}>Sí, apruebo</Button></footer></div>
      </Modal>

      <Modal open={confirmDelete} title="Eliminar caso en cascada" description="Esta acción es irreversible y está restringida a administradores." onClose={() => !deleting && setConfirmDelete(false)}>
        <div className="cascade-delete"><Trash2 size={28} /><div><p>Se eliminará <strong>{detail.code}</strong> junto con:</p><ul><li>El registro del correo recibido</li><li>Los {detail.documentCount} documentos relacionados</li><li>El control documental y el análisis integral</li><li>La carpeta completa del caso en S3</li></ul></div><footer><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button><Button variant="danger" loading={deleting} onClick={() => void deleteCase()}>Eliminar definitivamente</Button></footer></div>
      </Modal>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
