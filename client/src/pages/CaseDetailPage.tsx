import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Code2,
  Copy,
  Download,
  FileCheck2,
  FileText,
  History,
  Landmark,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { AiSummaryResponse, CaseDetail, CorePayloadResponse, ValidationRule } from '../types';
import {
  canPerformCaseAction,
  documentTypeLabel,
  fieldPathLabel,
  formatCurrency,
  formatDate,
  identityTypeLabel,
  payloadForDisplay,
  riskLevelLabel,
  riskRouteLabel,
  riskTone,
  ruleCodeLabel,
  spanishDynamicText,
  stateLabel,
  statusTone,
  titleFromStatus,
} from '../utils';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Progress, Toast } from '../components/ui';
import DocumentIntelligencePanel from '../components/DocumentIntelligencePanel';

type DetailTab = 'documents' | 'intelligence' | 'data' | 'rules' | 'audit';
type PendingAction = { action: string; title: string; description: string; tone?: 'danger' | 'success' };

const actionLabels: Record<string, string> = {
  return: 'Devolver a agencia',
  correct: 'Registrar corrección',
  escalate: 'Escalar a Cumplimiento',
  approve: 'Aprobar expediente',
  'ready-core': 'Marcar listo para sistema central',
  archive: 'Archivar caso',
};

function RuleIcon({ rule }: { rule: ValidationRule }) {
  const severity = rule.severity.toLowerCase();
  if (rule.resolved) return <CheckCircle2 size={18} />;
  if (severity === 'error') return <XCircle size={18} />;
  if (severity === 'warning') return <AlertTriangle size={18} />;
  return <AlertCircle size={18} />;
}

export default function CaseDetailPage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab');
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>(queryTab === 'ai' ? 'intelligence' : 'documents');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [payload, setPayload] = useState<CorePayloadResponse | null>(null);
  const [aiSummary, setAiSummary] = useState<AiSummaryResponse | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.case(id);
      setDetail(data);
      if (data.aiSummary) setAiSummary(data.aiSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar el expediente.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (queryTab === 'ai') setTab('intelligence');
  }, [queryTab]);

  const rulesSummary = useMemo(() => {
    const rules = detail?.validations || [];
    return {
      errors: rules.filter((rule) => !rule.resolved && rule.severity.toLowerCase() === 'error').length,
      warnings: rules.filter((rule) => !rule.resolved && rule.severity.toLowerCase() === 'warning').length,
      passed: rules.filter((rule) => rule.resolved).length,
    };
  }, [detail]);

  const audit = detail?.auditTrail || detail?.audit || [];
  const can = (action: string) => canPerformCaseAction(detail?.status, detail?.canActions, action);

  const runAction = async () => {
    if (!detail || !pendingAction) return;
    setWorking(pendingAction.action);
    try {
      const response = await api.action(detail.id, pendingAction.action, actionNote.trim() || undefined);
      setDetail(response.case);
      setPendingAction(null);
      setActionNote('');
      setToast({ message: `${actionLabels[pendingAction.action] || 'Acción'} registrada correctamente.`, tone: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No fue posible registrar la acción.', tone: 'danger' });
    } finally {
      setWorking('');
    }
  };

  const runRevalidation = async () => {
    if (!detail) return;
    setWorking('revalidate');
    try {
      const response = await api.revalidate(detail.id);
      setDetail(response.case);
      setTab('rules');
      setToast({ message: `Validación completada: ${response.summary.errors} errores y ${response.summary.warnings} alertas.`, tone: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No se pudieron procesar las reglas.', tone: 'danger' });
    } finally {
      setWorking('');
    }
  };

  const applyCorrection = async () => {
    if (!detail) return;
    setWorking('correction');
    try {
      const response = await api.demoCorrection(detail.id);
      setDetail(response.case);
      setTab('rules');
      setToast({ message: 'Corrección de demostración aplicada y expediente revalidado.', tone: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No se pudo aplicar la corrección.', tone: 'danger' });
    } finally {
      setWorking('');
    }
  };

  const loadAiSummary = async () => {
    if (!detail) return;
    setWorking('ai');
    try {
      setAiSummary(await api.aiSummary(detail.id));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No se pudo generar el resumen.', tone: 'danger' });
    } finally {
      setWorking('');
    }
  };

  const openPayload = async () => {
    if (!detail) return;
    setWorking('payload');
    try {
      setPayload(await api.corePayload(detail.id));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No se pudieron generar los datos de integración.', tone: 'danger' });
    } finally {
      setWorking('');
    }
  };

  const uploadDocument = async (file?: File) => {
    if (!detail || !file) return;
    setWorking('upload');
    try {
      const response = await api.uploadDocument(detail.id, file, 'OTRO');
      setDetail(response.case);
      setToast({ message: 'Documento sintético incorporado al expediente.', tone: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No se pudo cargar el documento.', tone: 'danger' });
    } finally {
      setWorking('');
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const downloadContract = async () => {
    if (!detail) return;
    setWorking('contract');
    try {
      await api.downloadContract(detail.id, detail.reference);
      setToast({ message: 'Contrato PDF generado correctamente.', tone: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'No se pudo descargar el contrato.', tone: 'danger' });
    } finally {
      setWorking('');
    }
  };

  const openAction = (action: string, title: string, description: string, tone?: 'danger' | 'success') => {
    setPendingAction({ action, title, description, tone });
    setActionNote('');
  };

  const selectTab = (nextTab: DetailTab) => {
    setTab(nextTab);
    setSearchParams(nextTab === 'intelligence' ? { tab: 'ai' } : {}, { replace: true });
  };

  if (loading && !detail) return <LoadingState label="Abriendo el expediente 360…" />;
  if (error && !detail) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return null;

  return (
    <div className="detail-page">
      <div className="detail-breadcrumb">
        <Link to="/casos"><ArrowLeft size={16} /> Volver a la bandeja</Link><ChevronRight size={15} /><span>{spanishDynamicText(detail.reference)}</span>
      </div>

      <section className="case-hero">
        <div className="case-hero__identity">
          <div className="case-hero__icon"><FileText size={25} /></div>
          <div>
            <div className="case-hero__reference"><span>{spanishDynamicText(detail.reference)}</span><Badge tone={statusTone(detail.status)} dot>{titleFromStatus(detail.status, detail.statusLabel)}</Badge></div>
            <h2>{spanishDynamicText(detail.client.fullName)}</h2>
            <p>{identityTypeLabel(detail.client.idType)} · {detail.client.idNumberMasked} <i /> {detail.product.plan}</p>
          </div>
        </div>
        <div className="case-hero__actions">
          <Button variant="secondary" icon={<Download size={16} />} loading={working === 'contract'} onClick={() => void downloadContract()}>Contrato</Button>
          <Button variant="secondary" icon={<Code2 size={16} />} loading={working === 'payload'} onClick={() => void openPayload()}>Datos para sistema central</Button>
        </div>
        <div className="case-hero__progress"><Progress value={detail.progress} label="Avance del flujo" /></div>
      </section>

      <section className="stage-strip" aria-label="Etapas del proceso">
        {['Recepción', 'Control documental', 'Análisis', 'Decisión', 'Sistema central'].map((stage, index) => {
          const activeIndex = Math.min(4, Math.max(0, Math.round((detail.progress || 0) / 25) - 1));
          return (
            <div className={`${index < activeIndex ? 'is-complete' : ''} ${index === activeIndex ? 'is-active' : ''}`} key={stage}>
              <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span><strong>{stage}</strong>{index < 4 && <i />}
            </div>
          );
        })}
      </section>

      <div className="detail-layout">
        <section className="detail-main">
          {tab !== 'intelligence' && <section className="ai-summary-card">
            <div className="ai-summary-card__icon"><Sparkles size={21} /></div>
            <div className="ai-summary-card__content">
              <header><div><span>Resumen asistido</span><Badge tone="purple">{aiSummary?.provider === 'gemini' ? 'Gemini' : 'Motor local'}</Badge></div><small>Solo orientativo · no toma decisiones</small></header>
              {aiSummary ? <p>{spanishDynamicText(aiSummary.summary)}</p> : <p>Genera una síntesis operativa de los datos, documentos y alertas del expediente para acelerar la revisión humana.</p>}
              <Button variant="ghost" icon={<Bot size={16} />} loading={working === 'ai'} onClick={() => void loadAiSummary()}>{aiSummary ? 'Actualizar resumen' : 'Generar resumen IA'}</Button>
            </div>
          </section>}

          <nav className="detail-tabs" aria-label="Contenido del expediente">
            <button className={tab === 'documents' ? 'is-active' : ''} type="button" onClick={() => selectTab('documents')}><FileText size={17} />Documentos <span>{detail.documents.length}</span></button>
            <button className={`detail-tabs__ai ${tab === 'intelligence' ? 'is-active' : ''}`} type="button" onClick={() => selectTab('intelligence')}><BrainCircuit size={17} />Inteligencia documental <Badge tone="purple">IA</Badge></button>
            <button className={tab === 'data' ? 'is-active' : ''} type="button" onClick={() => selectTab('data')}><UserRound size={17} />Datos consolidados</button>
            <button className={tab === 'rules' ? 'is-active' : ''} type="button" onClick={() => selectTab('rules')}><ListChecks size={17} />Reglas <span className={rulesSummary.errors ? 'tab-count--danger' : ''}>{rulesSummary.errors + rulesSummary.warnings}</span></button>
            <button className={tab === 'audit' ? 'is-active' : ''} type="button" onClick={() => selectTab('audit')}><History size={17} />Auditoría</button>
          </nav>

          <section className={`tab-panel ${tab === 'intelligence' ? 'tab-panel--intelligence' : ''}`}>
            {tab === 'documents' && (
              <div>
                <header className="tab-panel__header">
                  <div><h3>Paquete documental</h3><p>Archivos clasificados y procesados por la demostración.</p></div>
                  <input ref={uploadRef} hidden type="file" accept="application/pdf" onChange={(event) => void uploadDocument(event.target.files?.[0])} />
                  <Button variant="secondary" icon={<Upload size={16} />} loading={working === 'upload'} onClick={() => uploadRef.current?.click()}>Adjuntar PDF</Button>
                </header>
                <div className="document-grid">
                  {detail.documents.map((document) => (
                    <article className="document-card" key={document.id}>
                      <div className={`document-card__icon ${document.status.toLowerCase().includes('observ') || document.status.toLowerCase().includes('warning') ? 'is-warning' : ''}`}><FileText size={22} /></div>
                      <div className="document-card__content">
                        <div><Badge tone={document.status.toLowerCase().includes('observ') || document.status.toLowerCase().includes('warning') ? 'warning' : 'success'} dot>{stateLabel(document.status)}</Badge>{document.synthetic && <span className="synthetic-tag">Sintético</span>}</div>
                        <h4>{document.name}</h4>
                        <p>{documentTypeLabel(document.type)} · {formatDate(document.uploadedAt)}</p>
                        {(document.confidence !== undefined || document.fieldsExtracted !== undefined) && <small>{document.fieldsExtracted || 0} campos extraídos · {Math.round((document.confidence || 0) * 100)}% confianza</small>}
                      </div>
                    </article>
                  ))}
                </div>
                {!detail.documents.length && <EmptyState icon={<FileText size={24} />} title="Sin documentos" body="Adjunta un PDF sintético para comenzar el análisis." />}
              </div>
            )}

            {tab === 'intelligence' && <DocumentIntelligencePanel caseData={detail} />}

            {tab === 'data' && (
              <div>
                <header className="tab-panel__header"><div><h3>Datos canónicos</h3><p>Una única fuente para formularios, contrato y sistema central.</p></div><Badge tone="success"><CheckCircle2 size={13} /> Consolidado</Badge></header>
                <div className="data-sections">
                  <DataSection icon={<UserRound size={18} />} title="Datos del cliente" fields={[
                    ['Nombre completo', detail.client.fullName], ['Identificación', `${identityTypeLabel(detail.client.idType)} · ${detail.client.idNumberMasked}`], ['Nacionalidad', detail.client.nationality], ['Residencia', detail.client.residenceCountry], ['Ciudad', detail.client.city], ['Ocupación', detail.client.occupation],
                  ]} />
                  <DataSection icon={<Landmark size={18} />} title="Plan y aporte" fields={[
                    ['Plan', detail.product.plan], ['Aporte', formatCurrency(detail.product.contributionAmount, detail.product.currency)], ['Frecuencia', detail.product.frequency], ['Forma de pago', detail.product.paymentMethod], ['Procedencia', detail.product.sourceOfFunds], ['Primer aporte', formatDate(detail.product.firstContributionDate)],
                  ]} />
                  <DataSection icon={<ShieldCheck size={18} />} title="Debida diligencia" fields={[
                    ['Nivel de riesgo', riskLevelLabel(detail.risk.level)], ['Puntaje', `${detail.risk.score}/100`], ['Ruta', riskRouteLabel(detail.risk.route)], ['Indicadores FATCA', detail.client.fatcaIndicators?.map(spanishDynamicText).join(', ') || 'Sin indicadores declarados'],
                  ]} />
                </div>
              </div>
            )}

            {tab === 'rules' && (
              <div>
                <header className="tab-panel__header">
                  <div><h3>Resultado del motor de reglas</h3><p>Validaciones determinísticas, explicables y trazables.</p></div>
                  <div className="tab-panel__actions">
                    {rulesSummary.errors > 0 && <Button variant="secondary" icon={<RotateCcw size={16} />} loading={working === 'correction'} onClick={() => void applyCorrection()}>Aplicar corrección de demostración</Button>}
                    <Button variant="secondary" icon={<RefreshCw size={16} />} loading={working === 'revalidate'} onClick={() => void runRevalidation()}>Revalidar</Button>
                  </div>
                </header>
                <div className="rules-summary">
                  <div className="rules-summary__error"><XCircle size={18} /><span><strong>{rulesSummary.errors}</strong> bloqueos</span></div>
                  <div className="rules-summary__warning"><AlertTriangle size={18} /><span><strong>{rulesSummary.warnings}</strong> alertas</span></div>
                  <div className="rules-summary__pass"><CheckCircle2 size={18} /><span><strong>{rulesSummary.passed}</strong> superadas</span></div>
                </div>
                <div className="rule-list">
                  {detail.validations.map((rule) => (
                    <article className={`rule-row rule-row--${rule.resolved ? 'resolved' : rule.severity.toLowerCase()}`} key={rule.id}>
                      <div className="rule-row__icon"><RuleIcon rule={rule} /></div>
                      <div className="rule-row__body">
                        <div><strong>{spanishDynamicText(rule.title)}</strong><code>Regla: {ruleCodeLabel(rule.code)}</code></div>
                        <p>{spanishDynamicText(rule.message)}</p>
                        <footer>{rule.documentType && <span>Documento: {documentTypeLabel(rule.documentType)}</span>}{rule.field && <span>Campo: {fieldPathLabel(rule.field)}</span>}{rule.policyRef && <span>Política: {spanishDynamicText(rule.policyRef)}</span>}</footer>
                      </div>
                      <Badge tone={rule.resolved ? 'success' : rule.severity.toLowerCase() === 'error' ? 'danger' : rule.severity.toLowerCase() === 'warning' ? 'warning' : 'info'}>{rule.resolved ? 'Superada' : rule.severity.toLowerCase() === 'error' ? 'Bloquea' : 'Revisar'}</Badge>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {tab === 'audit' && (
              <div>
                <header className="tab-panel__header"><div><h3>Historial del expediente</h3><p>Registro persistente de acciones, responsables y cambios de estado.</p></div><Badge tone="neutral">{audit.length} eventos</Badge></header>
                <div className="audit-timeline">
                  {audit.map((event, index) => (
                    <article key={event.id}>
                      <div className="audit-timeline__rail"><span>{index === 0 ? <ClipboardCheck size={16} /> : <History size={16} />}</span>{index < audit.length - 1 && <i />}</div>
                      <div className="audit-timeline__content"><header><strong>{spanishDynamicText(event.label || actionLabels[event.action] || 'Acción registrada')}</strong><time>{formatDate(event.createdAt, true)}</time></header><p>{spanishDynamicText(event.note || 'Acción registrada en el expediente.')}</p><footer><span className="avatar avatar--small">{event.actor.slice(0, 1).toUpperCase()}</span>{spanishDynamicText(event.actor)}{event.fromStatus && event.toStatus && <Badge tone="neutral">{titleFromStatus(event.fromStatus)} → {titleFromStatus(event.toStatus)}</Badge>}</footer></div>
                    </article>
                  ))}
                </div>
                {!audit.length && <EmptyState icon={<History size={24} />} title="Sin eventos registrados" body="Las próximas acciones aparecerán aquí." />}
              </div>
            )}
          </section>
        </section>

        <aside className="detail-aside">
          <section className="side-card">
            <header><h3>Resumen del análisis</h3><Badge tone={riskTone(detail.risk.level)}>Riesgo {riskLevelLabel(detail.risk.level)}</Badge></header>
            <div className="risk-score"><div style={{ '--score': `${detail.risk.score * 3.6}deg` } as React.CSSProperties}><span><strong>{detail.risk.score}</strong><small>/ 100</small></span></div><p><strong>{riskRouteLabel(detail.risk.route)}</strong><span>Ruta sugerida por reglas</span></p></div>
            <dl className="side-data"><div><dt>Aporte</dt><dd>{formatCurrency(detail.product.contributionAmount, detail.product.currency)}</dd></div><div><dt>Procedencia</dt><dd>{spanishDynamicText(detail.product.sourceOfFunds)}</dd></div><div><dt>Agencia</dt><dd>{spanishDynamicText(detail.agency)}</dd></div><div><dt>Asignado a</dt><dd>{spanishDynamicText(detail.assignee || 'Sin asignar')}</dd></div></dl>
            {detail.risk.reasons?.length > 0 && <div className="risk-reasons"><strong>Factores considerados</strong>{detail.risk.reasons.map((reason) => <span key={reason}><ShieldAlert size={14} />{spanishDynamicText(reason)}</span>)}</div>}
          </section>

          <section className={`sla-card ${detail.sla.breached ? 'sla-card--breached' : ''}`}>
            <Clock3 size={20} /><div><span>Tiempo en proceso</span><strong>{detail.sla.ageHours.toFixed(1)} horas</strong><small>{detail.sla.breached ? 'Plazo de atención vencido · requiere atención' : `Vence ${formatDate(detail.sla.dueAt, true)}`}</small></div>
          </section>

          <section className="side-card decision-card">
            <header><div><h3>Decisión del caso</h3><p>Acciones disponibles para tu rol</p></div></header>
            <div className="decision-actions">
              {can('return') && <Button variant="danger" icon={<RotateCcw size={16} />} onClick={() => openAction('return', 'Devolver expediente', 'Envía el caso a la agencia con una causa clara de reproceso.', 'danger')}>Devolver a agencia</Button>}
              {can('correct') && <Button variant="secondary" icon={<MessageSquareText size={16} />} onClick={() => openAction('correct', 'Registrar corrección', 'Documenta la subsanación recibida y conserva el historial de versiones.')}>Registrar corrección</Button>}
              {can('escalate') && <Button variant="secondary" icon={<ShieldAlert size={16} />} onClick={() => openAction('escalate', 'Escalar a Cumplimiento', 'Cumplimiento recibirá las alertas y evidencias relevantes.')}>Escalar a Cumplimiento</Button>}
              {can('approve') && <Button variant="success" icon={<CheckCircle2 size={16} />} onClick={() => openAction('approve', 'Aprobar expediente', 'Confirma que la revisión humana fue completada.', 'success')}>Aprobar expediente</Button>}
              {can('ready-core') && <Button variant="success" icon={<Send size={16} />} onClick={() => openAction('ready-core', 'Marcar listo para sistema central', 'Los datos de integración quedarán preparados en modo simulación.', 'success')}>Listo para sistema central</Button>}
              {can('archive') && <Button variant="secondary" icon={<FileCheck2 size={16} />} onClick={() => openAction('archive', 'Archivar expediente', 'Cierra el recorrido del caso en la demostración.')}>Archivar caso</Button>}
              {detail.canActions?.length === 0 && <p className="decision-complete"><CheckCircle2 size={18} /> Este caso no tiene acciones pendientes.</p>}
            </div>
            <p className="decision-note"><ShieldCheck size={15} /> Toda decisión queda registrada con usuario, fecha y justificación.</p>
          </section>
        </aside>
      </div>

      <Modal open={Boolean(pendingAction)} title={pendingAction?.title || ''} description={pendingAction?.description} onClose={() => setPendingAction(null)}>
        <div className="action-form">
          <label className="field"><span>Comentario de la decisión {pendingAction?.action === 'return' && <b>*</b>}</span><textarea rows={4} value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="Describe el motivo y la acción esperada…" /></label>
          <div className="action-form__identity"><span className="avatar">CM</span><div><strong>Firmado por Cinthia M.</strong><small>Afiliaciones · Usuario B · {formatDate(new Date().toISOString(), true)}</small></div></div>
          <footer><Button variant="ghost" onClick={() => setPendingAction(null)}>Cancelar</Button><Button variant={pendingAction?.tone === 'danger' ? 'danger' : pendingAction?.tone === 'success' ? 'success' : 'primary'} loading={Boolean(working)} disabled={pendingAction?.action === 'return' && !actionNote.trim()} onClick={() => void runAction()}>{pendingAction?.title}</Button></footer>
        </div>
      </Modal>

      <Modal open={Boolean(payload)} title="Datos preparados para el sistema central" description="Vista de simulación: no se enviará información a sistemas externos." onClose={() => setPayload(null)} wide>
        {payload && (
          <div className="payload-viewer">
            <div className="payload-viewer__meta"><div><span>Destino</span><strong>{spanishDynamicText(payload.target)}</strong></div><div><span>Modo</span><Badge tone="warning">{spanishDynamicText(payload.mode)}</Badge></div><div><span>Validación</span><Badge tone={payload.validation.valid ? 'success' : 'danger'}>{payload.validation.valid ? 'Válido' : 'Con errores'}</Badge></div><Button variant="secondary" icon={<Copy size={16} />} onClick={() => { void navigator.clipboard.writeText(JSON.stringify(payloadForDisplay(payload.payload), null, 2)); setToast({ message: 'Resultado copiado al portapapeles.', tone: 'success' }); }}>Copiar resultado</Button></div>
            <pre><code>{JSON.stringify(payloadForDisplay(payload.payload), null, 2)}</code></pre>
            {payload.validation.errors.length > 0 && <div className="payload-errors">{payload.validation.errors.map((item) => <span key={item}><AlertCircle size={15} />{spanishDynamicText(item)}</span>)}</div>}
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function DataSection({ icon, title, fields }: { icon: React.ReactNode; title: string; fields: Array<[string, string | undefined]> }) {
  return (
    <section>
      <header>{icon}<h4>{title}</h4></header>
      <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ? spanishDynamicText(value) : '—'}</dd></div>)}</dl>
    </section>
  );
}
