import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleGauge,
  ExternalLink,
  FileSearch,
  Files,
  GitCompareArrows,
  LocateFixed,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { AiConsistencyCheck, GeneratedCaseDetail } from '../types';
import { documentTypeLabel, formatCurrency, formatEvidenceValue } from '../utils';
import { Badge, Button } from './ui';

type FieldFilter = 'all' | 'high' | 'review';

const percent = (value: number) => Math.round((value <= 1 ? value * 100 : value));
const verdictLabel = (value: string) => ({ MATCH: 'Coincide', MISMATCH: 'Diferencia', MISSING: 'Faltante', REVIEW: 'Revisar' }[value.toUpperCase()] || value);
const verdictTone = (value: string) => value.toUpperCase() === 'MATCH' ? 'success' : value.toUpperCase() === 'MISMATCH' || value.toUpperCase() === 'MISSING' ? 'danger' : 'warning';
const riskTone = (level = '') => level === 'ALTO' ? 'danger' : level === 'MEDIO' ? 'warning' : 'success';
const routeLabel = (route = '') => ({ REVISION_ESTANDAR: 'Revisión estándar', REVISION_REFORZADA: 'Revisión reforzada', CUMPLIMIENTO: 'Cumplimiento' }[route] || route);

export default function GeneratedCaseIntelligencePanel({
  detail,
  analyzing,
  onAnalyze,
}: {
  detail: GeneratedCaseDetail;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  const insights = detail.documentIntelligence;
  const [filter, setFilter] = useState<FieldFilter>('all');
  const [selectedFieldId, setSelectedFieldId] = useState('');

  useEffect(() => {
    if (insights?.extractedFields.length && !insights.extractedFields.some((field) => field.id === selectedFieldId)) {
      setSelectedFieldId(insights.extractedFields[0].id);
    }
  }, [insights, selectedFieldId]);

  const fields = useMemo(() => {
    const source = insights?.extractedFields || [];
    if (filter === 'high') return source.filter((field) => percent(field.confidence) >= 90 && field.status.toUpperCase() === 'EXTRACTED');
    if (filter === 'review') return source.filter((field) => percent(field.confidence) < 90 || field.status.toUpperCase() !== 'EXTRACTED');
    return source;
  }, [filter, insights]);
  const selectedField = insights?.extractedFields.find((field) => field.id === selectedFieldId) || insights?.extractedFields[0];
  const selectedDocument = detail.documents.find((document) => document.id === selectedField?.documentId);
  const selectedUrl = selectedDocument ? `${api.generatedDocumentUrl(detail.id, selectedDocument.id)}#page=${selectedField?.page || 1}` : '';
  const consistencyMatches = insights?.consistency.filter((item) => item.verdict === 'MATCH').length || 0;
  const consistencyReview = (insights?.consistency.length || 0) - consistencyMatches;

  if (detail.documentAnalysis?.missingCount) {
    return (
      <section className="generated-analysis-gate">
        <span><AlertTriangle size={26} /></span>
        <div><small>Siguiente etapa</small><h3>Análisis integral pendiente</h3><p>El motor se ejecutará automáticamente cuando la matriz documental llegue al 100 %. Falta completar {detail.documentAnalysis.missingCount} requisito(s).</p></div>
        <Badge tone="warning">Control documental</Badge>
      </section>
    );
  }

  if (detail.intelligenceStatus?.status === 'ERROR' && !insights) {
    return (
      <section className="generated-analysis-gate has-error">
        <span><AlertCircle size={26} /></span>
        <div><small>Análisis interrumpido</small><h3>No se pudo completar el análisis</h3><p>{detail.intelligenceStatus.error || 'El motor documental no devolvió un resultado utilizable.'}</p></div>
        <Button icon={<RefreshCw size={16} />} loading={analyzing} onClick={onAnalyze}>Reintentar</Button>
      </section>
    );
  }

  if (!insights) {
    return (
      <section className="generated-analysis-gate is-ready">
        <span><BrainCircuit size={27} /></span>
        <div><small>{analyzing ? 'Procesando expediente' : 'Paquete completo'}</small><h3>{analyzing ? 'Análisis documental en curso' : 'Listo para el análisis integral'}</h3><p>{analyzing ? 'Gemini está extrayendo campos; luego se aplicarán las reglas de consistencia, procedencia y riesgo.' : 'El expediente ya superó el control de recepción y puede procesarse.'}</p></div>
        {!analyzing && <Button icon={<BrainCircuit size={16} />} onClick={onAnalyze}>Ejecutar análisis</Button>}
        {analyzing && <Badge tone="purple"><Sparkles size={12} /> Analizando</Badge>}
      </section>
    );
  }

  return (
    <div className="document-ai generated-document-ai">
      <section className="generated-ai-hero">
        <span><BrainCircuit size={25} /></span>
        <div><div><Badge tone="purple"><Sparkles size={12} /> Gemini + reglas AFPC</Badge><Badge tone={riskTone(detail.risk?.level)}><CircleGauge size={12} /> Riesgo {detail.risk?.level || 'por revisar'}</Badge></div><h3>Análisis integral del expediente</h3><p>Extracción de documentos reales con cruces explicables. La recomendación orienta al analista y nunca sustituye su decisión.</p></div>
        <Button variant="secondary" icon={<RefreshCw size={15} />} loading={analyzing} onClick={onAnalyze}>Analizar nuevamente</Button>
      </section>

      <section className="generated-workflow-pipeline" aria-label="Flujo de análisis completado">
        {[
          ['Clasificación', `${insights.documents.length} documentos`],
          ['Extracción', `${insights.extractedFields.length} campos`],
          ['Consistencia', `${consistencyMatches}/${insights.consistency.length} coincidencias`],
          ['Riesgo', `${detail.risk?.score ?? 0}/100`],
        ].map(([label, value], index) => <div key={label}><span><Check size={14} /></span><p><strong>{label}</strong><small>{value}</small></p>{index < 3 && <i />}</div>)}
      </section>

      <section className="ai-metrics">
        <Metric icon={<Files size={18} />} label="Documentos analizados" value={String(insights.metrics.documentsProcessed)} detail="Clasificados desde S3" />
        <Metric icon={<FileSearch size={18} />} label="Campos extraídos" value={String(insights.metrics.fieldsExtracted)} detail={`${percent(insights.metrics.averageConfidence)}% confianza promedio`} tone="blue" />
        <Metric icon={<GitCompareArrows size={18} />} label="Consistencia" value={`${percent(insights.metrics.consistencyRate)}%`} detail={`${consistencyReview} control(es) por revisar`} tone="orange" />
        <Metric icon={<CircleGauge size={18} />} label="Riesgo del caso" value={detail.risk?.level || 'N/D'} detail={routeLabel(detail.risk?.route)} tone={detail.risk?.level === 'ALTO' ? 'red' : 'purple'} />
      </section>

      <section className="ai-executive-summary">
        <div className="ai-executive-summary__icon"><Sparkles size={22} /></div>
        <div><header><span>Resumen del análisis</span><small>{detail.intelligenceStatus?.model || 'Gemini'} · resultado almacenado</small></header><p>{insights.executiveSummary}</p></div>
      </section>

      <section className="ai-section">
        <header className="ai-section__header">
          <div><span className="ai-section__icon"><LocateFixed size={18} /></span><div><h4>Campos extraídos y evidencia</h4><p>Cada valor conserva el documento y la página donde fue identificado.</p></div></div>
          <div className="ai-filter-group" role="group" aria-label="Filtrar campos">
            <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>Todos</button>
            <button type="button" className={filter === 'high' ? 'is-active' : ''} onClick={() => setFilter('high')}>Alta confianza</button>
            <button type="button" className={filter === 'review' ? 'is-active' : ''} onClick={() => setFilter('review')}>Revisar</button>
          </div>
        </header>
        <div className="generated-evidence-workbench">
          <div className="extracted-field-list">
            {fields.map((field) => {
              const review = percent(field.confidence) < 90 || field.status.toUpperCase() !== 'EXTRACTED';
              return <button type="button" className={`${field.id === selectedField?.id ? 'is-selected' : ''} ${review ? 'needs-review' : ''}`} key={field.id} onClick={() => setSelectedFieldId(field.id)}><div><span>{field.label}</span><Badge tone={review ? 'warning' : 'success'}>{review ? 'Revisar' : 'Extraído'}</Badge></div><strong>{formatEvidenceValue(field.value)}</strong><footer><span><i style={{ width: `${percent(field.confidence)}%` }} /></span><em>{percent(field.confidence)}%</em><small>Pág. {field.page}</small></footer></button>;
            })}
            {!fields.length && <div className="ai-mini-empty"><CheckCircle2 size={20} /><span>No hay campos en este filtro.</span></div>}
          </div>
          <div className="generated-evidence-preview">
            <header><div><FileSearch size={17} /><span><strong>{selectedField?.label || 'Evidencia documental'}</strong><small>{selectedDocument?.filename || 'Selecciona un campo'}</small></span></div>{selectedUrl && <a href={selectedUrl} target="_blank" rel="noreferrer">Abrir fuente <ExternalLink size={14} /></a>}</header>
            {selectedUrl ? <iframe key={`${selectedField?.id}-${selectedField?.page}`} src={selectedUrl} title={`Evidencia de ${selectedField?.label}`} /> : <div className="ai-mini-empty"><FileSearch size={22} /><span>Selecciona un campo para visualizar su fuente.</span></div>}
            {selectedField && <div className="generated-evidence-caption"><Target size={15} /><p><span>Evidencia detectada</span>{selectedField.evidence}</p><Badge tone={percent(selectedField.confidence) >= 90 ? 'success' : 'warning'}>{percent(selectedField.confidence)}%</Badge></div>}
          </div>
        </div>
      </section>

      <section className="ai-section">
        <header className="ai-section__header"><div><span className="ai-section__icon ai-section__icon--orange"><GitCompareArrows size={18} /></span><div><h4>Matriz de consistencia</h4><p>Contraste de los mismos datos a través de fuentes independientes.</p></div></div><Badge tone={consistencyReview ? 'warning' : 'success'}>{consistencyReview ? `${consistencyReview} por revisar` : 'Fuentes consistentes'}</Badge></header>
        <div className="consistency-list">{insights.consistency.map((check) => <ConsistencyRow check={check} key={check.field} />)}</div>
      </section>

      <div className="ai-two-column">
        <section className="ai-section">
          <header className="ai-section__header"><div><span className="ai-section__icon ai-section__icon--danger"><AlertTriangle size={18} /></span><div><h4>Alertas y anomalías</h4><p>Hallazgos explicados y vinculados con evidencia.</p></div></div><Badge tone={insights.anomalies.length ? 'warning' : 'success'}>{insights.anomalies.length} hallazgo(s)</Badge></header>
          <div className="anomaly-list">
            {insights.anomalies.map((anomaly) => <article className={`anomaly-card anomaly-card--${anomaly.severity.toLowerCase()}`} key={anomaly.id}><div className="anomaly-card__icon">{anomaly.severity.toLowerCase() === 'high' ? <XCircle size={18} /> : <AlertTriangle size={18} />}</div><div><header><strong>{anomaly.title}</strong><Badge tone={anomaly.severity.toLowerCase() === 'high' ? 'danger' : 'warning'}>Severidad {anomaly.severity.toLowerCase() === 'high' ? 'alta' : 'media'}</Badge></header><p>{anomaly.explanation}</p><dl><div><dt>Evidencia vinculada</dt><dd>{anomaly.evidenceRefs.length} referencia(s)</dd></div><div><dt>Acción sugerida</dt><dd>{anomaly.suggestedAction}</dd></div></dl><code>Regla: {anomaly.ruleCode}</code></div></article>)}
            {!insights.anomalies.length && <div className="ai-success-empty"><CheckCircle2 size={24} /><div><strong>Sin anomalías materiales</strong><p>Las reglas configuradas no detectaron señales adicionales.</p></div></div>}
          </div>
        </section>

        <section className="ai-section source-funds-card">
          <header className="ai-section__header"><div><span className="ai-section__icon"><Target size={18} /></span><div><h4>Procedencia de fondos</h4><p>Alineación entre declaración, perfil y aporte.</p></div></div><Badge tone={insights.sourceOfFunds.alignment === 'CONSISTENT' ? 'success' : 'warning'}>{insights.sourceOfFunds.alignment === 'CONSISTENT' ? 'Alineada' : 'Revisar'}</Badge></header>
          <div className="source-funds-score"><div style={{ '--score': `${percent(insights.sourceOfFunds.confidence) * 3.6}deg` } as React.CSSProperties}><span><strong>{percent(insights.sourceOfFunds.confidence)}%</strong><small>confianza</small></span></div><div><span>Fuente declarada</span><strong>{insights.sourceOfFunds.declaredSource}</strong><small>{formatCurrency(insights.sourceOfFunds.amount, insights.sourceOfFunds.currency)}</small></div></div>
          <p className="source-funds-explanation">{insights.sourceOfFunds.explanation}</p>
          <div className="source-checks">{insights.sourceOfFunds.checks.map((check) => <div key={check.code}><span className={check.status.toUpperCase() === 'PASS' ? 'is-pass' : 'is-review'}>{check.status.toUpperCase() === 'PASS' ? <Check size={13} /> : <AlertCircle size={13} />}</span><p><strong>{check.label}</strong><small>{check.reason}</small></p></div>)}</div>
          <footer><span>Referencia de política</span><strong>{insights.sourceOfFunds.policyRef}</strong></footer>
        </section>
      </div>

      <section className="ai-recommendation generated-ai-recommendation">
        <div className="ai-recommendation__seal"><ShieldCheck size={30} /></div>
        <div className="ai-recommendation__main"><div className="ai-recommendation__eyebrow"><Sparkles size={14} /> Recomendación asistida</div><h4>{insights.recommendation.label}</h4><p>{insights.recommendation.rationale.join(' ')}</p><div className="ai-next-steps">{[...insights.recommendation.nextSteps].sort((a, b) => a.order - b.order).map((step) => <div key={`${step.order}-${step.action}`}><span>{step.order}</span><p><strong>{step.action}</strong><small>{step.owner} · {step.reason}</small></p><ArrowRight size={16} /></div>)}</div></div>
        <aside><Badge tone={riskTone(detail.risk?.level)}>{detail.risk?.score ?? 0}/100 · {detail.risk?.level}</Badge><div><ShieldCheck size={18} /><span><strong>Decisión humana pendiente</strong><small>La IA no aprueba, rechaza ni escala el expediente.</small></span></div></aside>
      </section>
    </div>
  );
}

function Metric({ icon, label, value, detail, tone = 'green' }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <article className={`ai-metric ai-metric--${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function ConsistencyRow({ check }: { check: AiConsistencyCheck }) {
  return <article className={`consistency-row consistency-row--${check.verdict.toLowerCase()}`}><div className="consistency-row__field"><span>{check.label}</span><Badge tone={verdictTone(check.verdict)}>{verdictLabel(check.verdict)}</Badge></div><div className="consistency-row__sources">{check.sources.map((source, index) => <div key={`${source.documentId}-${index}`}><small>{documentTypeLabel(source.documentType)}</small><strong>{formatEvidenceValue(source.value)}</strong><em>{percent(source.confidence)}%</em></div>)}</div><p>{check.explanation}</p></article>;
}
