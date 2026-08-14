import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Download,
  Eye,
  ExternalLink,
  FileSearch,
  Files,
  GitCompareArrows,
  LocateFixed,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import { buildFallbackInsights, buildSpanishInsightsExport, getConsistencyStats, toConfidencePercent } from '../documentIntelligence';
import { verifiedEvidenceBoxStyle } from '../evidenceLocation';
import type { AiConsistencyCheck, CaseDetail, DocumentAiInsights } from '../types';
import {
  documentTypeLabel,
  formatCurrency,
  formatDate,
  formatEvidenceValue,
  ruleCodeLabel,
  spanishDynamicText,
  stateLabel,
} from '../utils';
import { Badge, Button } from './ui';

type FieldFilter = 'all' | 'high' | 'review';

const pipelineBlueprint = [
  { id: 'classify', label: 'Clasificar', description: 'Tipo y calidad', icon: Files },
  { id: 'extract', label: 'Extraer', description: 'Campos y evidencia', icon: ScanLine },
  { id: 'contrast', label: 'Contrastar', description: 'Cruce de fuentes', icon: GitCompareArrows },
  { id: 'risk', label: 'Evaluar riesgo', description: 'Señales explicables', icon: CircleGauge },
];

const verdictTone = (verdict: string) => {
  const value = verdict.toUpperCase();
  if (value === 'MATCH') return 'success';
  if (value === 'MISMATCH' || value === 'MISSING') return 'danger';
  return 'warning';
};

const verdictLabel = (verdict: string) => {
  const labels: Record<string, string> = { MATCH: 'Coincide', MISMATCH: 'Diferencia', MISSING: 'Faltante', REVIEW: 'Revisar' };
  return labels[verdict.toUpperCase()] || 'Estado no reconocido';
};

const anomalyTone = (severity: string) => {
  const value = severity.toLowerCase();
  if (value === 'high') return 'danger';
  if (value === 'medium') return 'warning';
  return 'info';
};

const anomalyLabel = (severity: string) => {
  const labels: Record<string, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };
  return labels[severity.toLowerCase()] || 'Sin clasificar';
};

const friendlyError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback;
  if (/not found|404/i.test(error.message)) return 'El servicio de inteligencia documental aún no está disponible.';
  if (/failed to fetch|network|conexi[oó]n/i.test(error.message)) return 'No fue posible conectar con el servicio local.';
  return fallback;
};

const analysisMetadataLabel = (value: string | undefined, kind: 'origin' | 'method') => {
  const labels: Record<string, string> = {
    'synthetic-canonical-snapshot': 'instantánea canónica sintética',
    'template-mapped-canonical-data': 'mapeo de campos para demostración',
  };
  return (value && labels[value]) || (kind === 'origin' ? 'instantánea sintética' : 'mapeo de campos para demostración');
};

export default function DocumentIntelligencePanel({ caseData }: { caseData: CaseDetail }) {
  const [insights, setInsights] = useState<DocumentAiInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [fallbackReason, setFallbackReason] = useState('');
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>('all');
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.aiInsights(caseData.id)
      .then((response) => {
        if (active) {
          setInsights(response);
          setSelectedFieldId(response.extractedFields?.[0]?.id || '');
          setFallbackReason('');
        }
      })
      .catch((requestError) => {
        if (active) {
          const fallback = buildFallbackInsights(caseData);
          setInsights(fallback);
          setSelectedFieldId(fallback.extractedFields[0]?.id || '');
          setFallbackReason(friendlyError(requestError, 'El servicio no respondió.'));
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [caseData]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setActiveStage(0);
    setFallbackReason('');
    const stageTimer = window.setInterval(() => setActiveStage((stage) => Math.min(3, stage + 1)), 430);
    try {
      const [response] = await Promise.all([
        api.analyzeAiInsights(caseData.id),
        new Promise((resolve) => window.setTimeout(resolve, 1650)),
      ]);
      setInsights(response);
      setSelectedFieldId(response.extractedFields?.[0]?.id || '');
      setActiveStage(4);
    } catch (requestError) {
      const fallback = buildFallbackInsights(caseData);
      setInsights(fallback);
      setSelectedFieldId(fallback.extractedFields[0]?.id || '');
      setFallbackReason(friendlyError(requestError, 'No se pudo consultar el motor remoto.'));
      setActiveStage(4);
    } finally {
      window.clearInterval(stageTimer);
      setAnalyzing(false);
    }
  };

  const consistencyStats = useMemo(() => getConsistencyStats(insights?.consistency || []), [insights]);
  const averageConfidence = useMemo(() => {
    const metric = insights?.metrics?.averageConfidence;
    if (typeof metric === 'number') return metric <= 1 ? Math.round(metric * 100) : Math.round(metric);
    const fields = insights?.extractedFields || [];
    return fields.length ? Math.round(fields.reduce((sum, field) => sum + toConfidencePercent(field.confidence), 0) / fields.length) : 0;
  }, [insights]);
  const processingSeconds = useMemo(() => insights?.metrics?.estimatedAutomatedSeconds ?? ((insights?.pipeline || []).reduce((sum, step) => sum + (step.durationMs || 0), 0) / 1000), [insights]);
  const estimatedMinutesSaved = useMemo(() => insights?.metrics?.estimatedMinutesSaved ?? Math.max(0, Math.round((insights?.documents.length || 0) * 3.5 + (insights?.extractedFields.length || 0) * .5)), [insights]);

  const filteredFields = useMemo(() => {
    const fields = insights?.extractedFields || [];
    if (fieldFilter === 'high') return fields.filter((field) => field.confidence >= .9 && ['EXTRACTED', 'CONFIRMED'].includes(field.status.toUpperCase()));
    if (fieldFilter === 'review') return fields.filter((field) => field.confidence < .9 || !['EXTRACTED', 'CONFIRMED'].includes(field.status.toUpperCase()));
    return fields;
  }, [fieldFilter, insights]);

  const selectedField = useMemo(() => {
    const fields = insights?.extractedFields || [];
    return fields.find((field) => field.id === selectedFieldId) || fields[0];
  }, [insights, selectedFieldId]);
  const selectedDocument = insights?.documents.find((document) => document.documentId === selectedField?.documentId);
  const verifiedBoxStyle = useMemo(() => verifiedEvidenceBoxStyle(selectedField), [selectedField]);
  const sourceDocument = caseData.documents.find((document) => document.id === selectedField?.documentId);
  const visualSource = Boolean(
    sourceDocument?.mimeType && ['application/pdf', 'image/png', 'image/jpeg'].includes(sourceDocument.mimeType),
  );
  const sourceUrl = selectedField?.documentId
    ? `/api/cases/${encodeURIComponent(caseData.id)}/documents/${encodeURIComponent(selectedField.documentId)}`
    : '';

  useEffect(() => {
    setPreviewFailed(false);
    setPreviewReady(false);
    setPreviewAspectRatio(null);
  }, [selectedField?.documentId, selectedField?.page]);

  const exportJson = () => {
    if (!insights) return;
    const blob = new Blob([JSON.stringify(buildSpanishInsightsExport(insights), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inteligencia-documental-${caseData.reference}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="document-ai">
      <section className="document-ai__hero">
        <div className="document-ai__orb document-ai__orb--one" />
        <div className="document-ai__orb document-ai__orb--two" />
        <div className="document-ai__hero-icon"><BrainCircuit size={27} /></div>
        <div className="document-ai__hero-copy">
          <div><Badge tone="purple"><Sparkles size={12} /> Inteligencia documental</Badge><Badge tone="success"><ShieldCheck size={12} /> Solo datos sintéticos</Badge></div>
          <h3>Entiende el expediente, no solo lo digitaliza</h3>
          <p>Clasifica, extrae, contrasta y explica cada señal con su evidencia. La recomendación orienta al analista; nunca reemplaza su decisión.</p>
        </div>
        <div className="document-ai__hero-actions">
          {insights && <Button variant="secondary" icon={<Download size={16} />} onClick={exportJson}>Exportar resultado</Button>}
          <Button icon={analyzing ? <WandSparkles size={17} /> : <BrainCircuit size={17} />} loading={analyzing} onClick={() => void runAnalysis()}>{insights ? 'Analizar nuevamente' : 'Analizar expediente'}</Button>
        </div>
      </section>

      {fallbackReason && (
        <div className="ai-fallback-banner" role="status">
          <Bot size={19} />
          <div><strong>Modo local explicable activo</strong><p>La conexión de IA no estuvo disponible; mostramos un análisis determinístico de demostración. Motivo: {fallbackReason}</p></div>
          <Badge tone="warning">Contingencia local</Badge>
        </div>
      )}

      <section className={`ai-pipeline ${analyzing ? 'is-running' : ''}`} aria-live="polite" aria-label="Flujo de inteligencia documental">
        <header><div><span>Flujo de análisis</span><strong>{analyzing ? `Procesando etapa ${Math.min(4, activeStage + 1)} de 4` : insights ? 'Análisis completado' : 'Listo para iniciar'}</strong></div>{insights?.analysis.cached && !analyzing && <Badge tone="neutral">Resultado almacenado</Badge>}</header>
        <div className="ai-pipeline__steps">
          {pipelineBlueprint.map((step, index) => {
            const Icon = step.icon;
            const pipelineAliases: Record<string, string[]> = { classify: ['classify', 'classification'], extract: ['extract', 'extraction'], contrast: ['contrast', 'consistency'], risk: ['risk'] };
            const apiStep = insights?.pipeline.find((item) => pipelineAliases[step.id]?.some((alias) => item.id.toLowerCase().includes(alias)));
            const status = analyzing ? index < activeStage ? 'completed' : index === activeStage ? 'running' : 'pending' : apiStep?.status || 'pending';
            return (
              <div className={`ai-pipeline-step ai-pipeline-step--${status}`} key={step.id}>
                <div className="ai-pipeline-step__rail"><span>{status === 'completed' ? <Check size={16} /> : <Icon size={18} />}</span>{index < pipelineBlueprint.length - 1 && <i />}</div>
                <div><strong>{step.label}</strong><small>{status === 'running' ? 'Procesando…' : step.description}</small>{apiStep && !analyzing && <em>{apiStep.itemsProcessed} {apiStep.itemsProcessed === 1 ? 'elemento' : 'elementos'} · {apiStep.durationMs} ms</em>}</div>
              </div>
            );
          })}
        </div>
      </section>

      {loading ? (
        <div className="ai-loading" role="status"><BrainCircuit size={28} className="ai-pulse" /><div><strong>Preparando inteligencia documental…</strong><span>Consultando el último análisis del expediente sintético.</span></div></div>
      ) : insights ? (
        <>
          <section className="ai-metrics" aria-label="Métricas del análisis documental">
            <Metric icon={<Files size={18} />} label="Documentos analizados" value={String(insights.metrics?.documentsProcessed ?? insights.documents.length)} detail="Clasificados y trazables" />
            <Metric icon={<FileSearch size={18} />} label="Campos extraídos" value={String(insights.metrics?.fieldsExtracted ?? insights.extractedFields.length)} detail={`${averageConfidence}% confianza promedio`} tone="blue" />
            <Metric icon={<GitCompareArrows size={18} />} label="Consistencia" value={`${insights.metrics?.consistencyRate !== undefined ? Math.round(insights.metrics.consistencyRate <= 1 ? insights.metrics.consistencyRate * 100 : insights.metrics.consistencyRate) : consistencyStats.score}%`} detail={`${consistencyStats.matched} de ${consistencyStats.total} coincidencias`} tone="orange" />
            <Metric icon={<Clock3 size={18} />} label="Ahorro estimado de demostración" value={`${estimatedMinutesSaved} min`} detail={`${processingSeconds.toFixed(1)} s de procesamiento`} tone="purple" />
          </section>

          <aside className="ai-transparency-note">
            <Eye size={18} />
            <div><strong>Análisis sobre expediente sintético · extracción mapeada para demostración</strong><p>Origen: {analysisMetadataLabel(insights.analysis.dataOrigin, 'origin')} · Método: {analysisMetadataLabel(insights.analysis.extractionMethod, 'method')}. La confianza refleja certeza de extracción, no cumplimiento regulatorio ni una decisión sobre el caso.</p></div>
          </aside>

          <section className="ai-executive-summary">
            <div className="ai-executive-summary__icon"><Sparkles size={22} /></div>
            <div><header><span>Resumen ejecutivo</span><small>Generado {formatDate(insights.analysis.generatedAt, true)} · {insights.analysis.provider === 'gemini' ? 'Gemini' : 'Motor local'}</small></header><p>{spanishDynamicText(insights.executiveSummary)}</p></div>
          </section>

          <section className="ai-section">
            <header className="ai-section__header">
              <div><span className="ai-section__icon"><LocateFixed size={18} /></span><div><h4>Campos extraídos y evidencia</h4><p>Cada valor mantiene vínculo al documento y página; la región se muestra cuando fue verificada en el PDF.</p></div></div>
              <div className="ai-filter-group" role="group" aria-label="Filtrar campos extraídos">
                <button type="button" className={fieldFilter === 'all' ? 'is-active' : ''} onClick={() => setFieldFilter('all')}>Todos</button>
                <button type="button" className={fieldFilter === 'high' ? 'is-active' : ''} onClick={() => setFieldFilter('high')}>Alta confianza</button>
                <button type="button" className={fieldFilter === 'review' ? 'is-active' : ''} onClick={() => setFieldFilter('review')}>Revisar</button>
              </div>
            </header>
            <div className="evidence-workbench">
              <div className="extracted-field-list">
                {filteredFields.map((field) => {
                  const confidence = toConfidencePercent(field.confidence);
                  const review = !['EXTRACTED', 'CONFIRMED'].includes(field.status.toUpperCase()) || confidence < 90;
                  return (
                    <button type="button" className={`${selectedField?.id === field.id ? 'is-selected' : ''} ${review ? 'needs-review' : ''}`} onClick={() => setSelectedFieldId(field.id)} aria-pressed={selectedField?.id === field.id} key={field.id}>
                      <div><span>{field.label}</span><Badge tone={review ? 'warning' : 'success'}>{review ? 'Revisar' : 'Extraído'}</Badge></div>
                      <strong>{formatEvidenceValue(field.value)}</strong>
                      <footer><span><i style={{ width: `${confidence}%` }} /></span><em>{confidence}%</em><small>Pág. {field.page}</small></footer>
                    </button>
                  );
                })}
                {!filteredFields.length && <div className="ai-mini-empty"><CheckCircle2 size={20} /><span>No hay campos en este filtro.</span></div>}
              </div>

              <div className="evidence-preview">
                <header>
                  <div><Eye size={17} /><span><strong>Evidencia visual</strong><small>{visualSource && !previewFailed ? previewReady ? 'Página original cargada' : 'Preparando página original' : 'Representación de respaldo'} · {selectedDocument?.name || selectedField?.documentType || 'Documento de demostración'}</small></span></div>
                  <div className="evidence-preview__controls">
                    <label><span className="sr-only">Seleccionar campo para evidenciar</span><select aria-label="Seleccionar campo para evidenciar" value={selectedField?.id || ''} onChange={(event) => setSelectedFieldId(event.target.value)}>{insights.extractedFields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label>
                    {selectedField?.documentId && <a href={`${sourceUrl}/content`} target="_blank" rel="noreferrer">Abrir documento fuente <ExternalLink size={14} /></a>}
                  </div>
                </header>
                <div
                  className={`synthetic-page ${visualSource && !previewFailed ? 'synthetic-page--source' : ''}`}
                  aria-label={`Vista de la página ${selectedField?.page || 1}`}
                  style={visualSource && !previewFailed && previewAspectRatio ? { aspectRatio: previewAspectRatio } : undefined}
                >
                  {visualSource && !previewFailed ? (
                    <>
                      {!previewReady && <div className="document-preview-loading"><ScanLine size={24} /><strong>Preparando vista previa…</strong><small>La primera apertura se guarda para las siguientes consultas.</small></div>}
                      <img
                        className={previewReady ? 'is-ready' : ''}
                        src={`${sourceUrl}/preview?page=${selectedField?.page || 1}`}
                        alt={`Página ${selectedField?.page || 1} de ${selectedDocument?.name || 'documento cargado'}`}
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          if (image.naturalWidth > 0 && image.naturalHeight > 0) setPreviewAspectRatio(image.naturalWidth / image.naturalHeight);
                          setPreviewReady(true);
                        }}
                        onError={() => { setPreviewFailed(true); setPreviewReady(false); setPreviewAspectRatio(null); }}
                      />
                    </>
                  ) : (
                    <>
                      <div className="synthetic-page__brand"><span /><i /></div>
                      <div className="synthetic-page__title" />
                      <div className="synthetic-page__line synthetic-page__line--one" />
                      <div className="synthetic-page__line synthetic-page__line--two" />
                      <div className="synthetic-page__line synthetic-page__line--three" />
                      <div className="synthetic-page__block" />
                      <div className="synthetic-page__line synthetic-page__line--four" />
                      <div className="synthetic-page__line synthetic-page__line--five" />
                    </>
                  )}
                  {selectedField && verifiedBoxStyle && visualSource && previewReady && <div className="synthetic-page__highlight" style={verifiedBoxStyle}><span>{selectedField.label}</span></div>}
                  <small>{visualSource && !previewFailed ? `Página original ${selectedField?.page || 1}` : `Representación ${selectedField?.page || 1}`}</small>
                </div>
                {verifiedBoxStyle
                  ? <p className="evidence-preview__notice evidence-preview__notice--verified"><CheckCircle2 size={13} /> Ubicación verificada en el PDF.</p>
                  : <p className="evidence-preview__notice evidence-preview__notice--unavailable"><AlertCircle size={13} /> Ubicación no disponible; abrir documento fuente.</p>}
                <div className="evidence-excerpt"><Target size={16} /><div><span>Evidencia detectada</span><p>{spanishDynamicText(selectedField?.evidence || 'Selecciona un campo para ver su evidencia.')}</p></div></div>
              </div>
            </div>
          </section>

          <section className="ai-section">
            <header className="ai-section__header"><div><span className="ai-section__icon ai-section__icon--orange"><GitCompareArrows size={18} /></span><div><h4>Matriz de consistencia</h4><p>Contraste de los mismos datos a través de fuentes independientes.</p></div></div><Badge tone={consistencyStats.review ? 'warning' : 'success'}>{consistencyStats.review ? `${consistencyStats.review} por revisar` : 'Fuentes consistentes'}</Badge></header>
            <div className="consistency-list">
              {insights.consistency.map((check) => <ConsistencyRow check={check} key={check.field} />)}
            </div>
          </section>

          <div className="ai-two-column">
            <section className="ai-section">
              <header className="ai-section__header"><div><span className="ai-section__icon ai-section__icon--danger"><AlertTriangle size={18} /></span><div><h4>Alertas y anomalías</h4><p>Hallazgos explicados, nunca decisiones automáticas.</p></div></div><Badge tone={insights.anomalies.length ? 'warning' : 'success'}>{insights.anomalies.length} hallazgos</Badge></header>
              <div className="anomaly-list">
                {insights.anomalies.map((anomaly) => (
                  <article className={`anomaly-card anomaly-card--${anomaly.severity.toLowerCase()}`} key={anomaly.id}>
                    <div className="anomaly-card__icon">{anomaly.severity.toLowerCase() === 'high' ? <XCircle size={18} /> : <AlertTriangle size={18} />}</div>
                    <div><header><strong>{spanishDynamicText(anomaly.title)}</strong><Badge tone={anomalyTone(anomaly.severity)}>Severidad {anomalyLabel(anomaly.severity)}</Badge></header><p>{spanishDynamicText(anomaly.explanation)}</p><dl><div><dt>Evidencia vinculada</dt><dd>{anomaly.evidenceRefs.length} {anomaly.evidenceRefs.length === 1 ? 'referencia trazable' : 'referencias trazables'}</dd></div><div><dt>Acción sugerida</dt><dd>{spanishDynamicText(anomaly.suggestedAction)}</dd></div></dl><code>Regla: {ruleCodeLabel(anomaly.ruleCode)}</code></div>
                  </article>
                ))}
                {!insights.anomalies.length && <div className="ai-success-empty"><CheckCircle2 size={24} /><div><strong>Sin anomalías materiales</strong><p>No se detectaron señales que requieran atención adicional en este análisis.</p></div></div>}
              </div>
            </section>

            <section className="ai-section source-funds-card">
              <header className="ai-section__header"><div><span className="ai-section__icon"><Target size={18} /></span><div><h4>Procedencia de fondos</h4><p>Alineación entre declaración, aporte y soportes.</p></div></div><Badge tone={['ALIGNED', 'CONSISTENT'].includes(insights.sourceOfFunds.alignment.toUpperCase()) ? 'success' : 'warning'}>{['ALIGNED', 'CONSISTENT'].includes(insights.sourceOfFunds.alignment.toUpperCase()) ? 'Alineada' : 'Revisar'}</Badge></header>
              <div className="source-funds-score"><div style={{ '--score': `${toConfidencePercent(insights.sourceOfFunds.confidence) * 3.6}deg` } as React.CSSProperties}><span><strong>{toConfidencePercent(insights.sourceOfFunds.confidence)}%</strong><small>confianza</small></span></div><div><span>Fuente declarada</span><strong>{spanishDynamicText(insights.sourceOfFunds.declaredSource)}</strong><small>{formatCurrency(insights.sourceOfFunds.amount, insights.sourceOfFunds.currency)}</small></div></div>
              <p className="source-funds-explanation">{spanishDynamicText(insights.sourceOfFunds.explanation)}</p>
              <div className="source-checks">{insights.sourceOfFunds.checks.map((check) => <div key={check.code}><span aria-label={stateLabel(check.status)} className={check.status.toUpperCase() === 'PASS' ? 'is-pass' : 'is-review'}>{check.status.toUpperCase() === 'PASS' ? <Check size={13} /> : <AlertCircle size={13} />}</span><p><strong>{spanishDynamicText(check.label)}</strong><small>{spanishDynamicText(check.reason)}</small></p></div>)}</div>
              <footer><span>Referencia de política</span><strong>{spanishDynamicText(insights.sourceOfFunds.policyRef)}</strong></footer>
            </section>
          </div>

          <section className="ai-recommendation">
            <div className="ai-recommendation__seal"><ShieldCheck size={30} /></div>
            <div className="ai-recommendation__main">
              <div className="ai-recommendation__eyebrow"><Sparkles size={14} /> Recomendación asistida por IA</div>
              <h4>{spanishDynamicText(insights.recommendation.label)}</h4>
              <p>{spanishDynamicText(insights.recommendation.rationale.join(' '))}</p>
              <div className="ai-next-steps">{[...insights.recommendation.nextSteps].sort((a, b) => a.order - b.order).map((step) => <div key={`${step.order}-${step.action}`}><span>{step.order}</span><p><strong>{spanishDynamicText(step.action)}</strong><small>{spanishDynamicText(step.owner)} · {spanishDynamicText(step.reason)}</small></p><ArrowRight size={16} /></div>)}</div>
            </div>
            <aside><Badge tone="purple">{toConfidencePercent(insights.recommendation.confidence)}% confianza</Badge><div><ShieldCheck size={18} /><span><strong>Aprobación humana obligatoria</strong><small>La IA no aprueba, rechaza ni escala este expediente.</small></span></div></aside>
          </section>
        </>
      ) : (
        <div className="ai-empty"><BrainCircuit size={30} /><h4>El expediente está listo para analizar</h4><p>Ejecuta el flujo para clasificar documentos y generar evidencia trazable.</p><Button icon={<WandSparkles size={17} />} onClick={() => void runAnalysis()}>Analizar expediente</Button></div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, detail, tone = 'green' }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <article className={`ai-metric ai-metric--${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function ConsistencyRow({ check }: { check: AiConsistencyCheck }) {
  return (
    <article className={`consistency-row consistency-row--${check.verdict.toLowerCase()}`}>
      <div className="consistency-row__field"><span>{spanishDynamicText(check.label)}</span><Badge tone={verdictTone(check.verdict)}>{verdictLabel(check.verdict)}</Badge></div>
      <div className="consistency-row__sources">
        {check.sources.map((source, index) => <div key={`${source.documentId}-${index}`}><small>{documentTypeLabel(source.documentType)}</small><strong>{formatEvidenceValue(source.value)}</strong><em>{toConfidencePercent(source.confidence)}%</em></div>)}
      </div>
      <p>{spanishDynamicText(check.explanation)}</p>
    </article>
  );
}
