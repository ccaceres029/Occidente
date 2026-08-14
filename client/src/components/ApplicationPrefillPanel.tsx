import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  FileText,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { api } from '../api';
import {
  applicationPrefillCriticalPaths,
  applicationPrefillFileName,
  applicationPrefillProviderLabel,
  applicationPrefillStatusLabel,
  applicationPrefillSummary,
  defaultApplicationPrefillSelection,
  isApplicationPrefillFieldSupported,
  isLowConfidenceField,
  normalizeConfidence,
  selectApplicationPrefillPatch,
} from '../applicationPrefill';
import type { ApplicationPrefillFormPatch, ApplicationPrefillResponse } from '../types';
import { Badge, Button } from './ui';

type AnalysisStatus = 'idle' | 'analyzing' | 'complete' | 'error';

const analysisStages = [
  { label: 'Leyendo el PDF', icon: ScanLine },
  { label: 'Extrayendo campos', icon: FileSearch },
  { label: 'Validando evidencia', icon: ShieldCheck },
  { label: 'Preparando formulario', icon: Sparkles },
];

const displayValue = (value: string | number | boolean | null) => {
  if (value === null || value === '') return 'No identificado';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
};

export default function ApplicationPrefillPanel({
  onApply,
  onDocumentReady,
  onClear,
}: {
  onApply: (patch: ApplicationPrefillFormPatch) => void;
  onDocumentReady: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ApplicationPrefillResponse | null>(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState(0);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (status !== 'analyzing') return undefined;
    setStage(0);
    const timer = window.setInterval(() => {
      setStage((current) => Math.min(current + 1, analysisStages.length - 1));
    }, 700);
    return () => window.clearInterval(timer);
  }, [status]);

  const analyze = async (file: File) => {
    if (!consent) {
      setStatus('error');
      setError('Autoriza el análisis del PDF antes de continuar.');
      return;
    }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setStatus('error');
      setError('Selecciona un archivo PDF para iniciar el prellenado.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus('error');
      setError('El PDF supera el máximo de 8 MB permitido para esta demostración.');
      return;
    }

    if (applied) onClear();
    setApplied(false);
    setSelectedFile(file);
    setResult(null);
    setError('');
    setStatus('analyzing');
    try {
      const response = await api.applicationPrefill(file, consent);
      setResult(response);
      setSelectedPaths(defaultApplicationPrefillSelection(response.fields));
      setStatus('complete');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'No fue posible analizar la solicitud.');
    }
  };

  const useSample = async () => {
    setSampleLoading(true);
    setError('');
    try {
      const file = await api.applicationPrefillSample();
      await analyze(file);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'No fue posible cargar la solicitud de prueba.');
    } finally {
      setSampleLoading(false);
    }
  };

  const clearAnalysis = () => {
    setStatus('idle');
    setSelectedFile(null);
    setResult(null);
    setError('');
    setStage(0);
    setSelectedPaths(new Set());
    setApplied(false);
    onClear();
    if (inputRef.current) inputRef.current.value = '';
  };

  const lowConfidenceCount = result?.fields.filter(isLowConfidenceField).length || 0;
  const extractedCount = result?.fields.filter((field) => field.value !== null && field.value !== '').length || 0;
  const averageConfidence = result?.fields.length
    ? Math.round(result.fields.reduce((total, field) => total + normalizeConfidence(field.confidence), 0) / result.fields.length)
    : 0;

  const applySelected = () => {
    if (!result || !selectedFile || selectedPaths.size === 0) return;
    onApply(selectApplicationPrefillPatch(result.formPatch, selectedPaths));
    onDocumentReady(selectedFile);
    setApplied(true);
  };

  const toggleField = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setApplied(false);
  };

  return (
    <section className={`application-prefill ${status === 'complete' ? 'application-prefill--complete' : ''}`} aria-labelledby="application-prefill-title">
      <header className="application-prefill__header">
        <span className="application-prefill__icon"><BrainCircuit size={23} aria-hidden="true" /></span>
        <div>
          <span className="application-prefill__eyebrow"><Sparkles size={12} /> Prellenado con inteligencia artificial</span>
          <h4 id="application-prefill-title">Carga la solicitud y evita volver a digitarla</h4>
          <p>Extraemos datos del PDF, mostramos la evidencia y prellenamos el formulario para que tú los revises.</p>
        </div>
        <Badge tone="purple">Entorno de demostración</Badge>
      </header>

      {status === 'idle' && (
        <>
        <label className="prefill-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>
            <strong>Autorizo el análisis de esta solicitud para la demostración</strong>
            <small>Si Gemini está configurado, el PDF puede procesarse fuera de este equipo. Revisa los datos extraídos antes de aplicarlos; el portal no aprueba automáticamente.</small>
          </span>
        </label>
        <div className={`application-prefill__start ${!consent ? 'is-disabled' : ''}`}>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            disabled={!consent}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void analyze(file);
            }}
          />
          <button
            className={`prefill-dropzone ${dragging ? 'is-dragging' : ''}`}
            type="button"
            disabled={!consent}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void analyze(file);
            }}
            aria-describedby="prefill-file-help"
          >
            <UploadCloud size={25} aria-hidden="true" />
            <span><strong>Arrastra la solicitud o selecciónala</strong><small id="prefill-file-help">PDF autorizado para demostración · máximo 8 MB</small></span>
          </button>
          <div className="application-prefill__or"><span>o</span></div>
          <Button type="button" variant="secondary" disabled={!consent} loading={sampleLoading} icon={<FileText size={17} />} onClick={() => void useSample()}>
            Usar solicitud de prueba
          </Button>
        </div>
        </>
      )}

      {status === 'analyzing' && selectedFile && (
        <div className="prefill-analysis" role="status" aria-live="polite">
          <div className="prefill-analysis__file">
            <span><FileText size={20} /></span>
            <div><strong>{selectedFile.name}</strong><small>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Fuente del prellenado</small></div>
            <LoaderCircle className="spin" size={21} />
          </div>
          <div className="prefill-analysis__stages">
            {analysisStages.map((item, index) => {
              const Icon = item.icon;
              return (
                <div className={`${index === stage ? 'is-active' : ''} ${index < stage ? 'is-complete' : ''}`} key={item.label}>
                  <i>{index < stage ? <CheckCircle2 size={15} /> : <Icon size={15} />}</i>
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
          <div className="prefill-analysis__progress" role="progressbar" aria-label="Avance del análisis" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((stage + 1) / analysisStages.length) * 100)}>
            <i style={{ width: `${((stage + 1) / analysisStages.length) * 100}%` }} />
          </div>
          <p>La inteligencia artificial está relacionando cada dato con su ubicación en el documento.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="prefill-error" role="alert">
          <AlertTriangle size={20} />
          <div><strong>No pudimos completar el prellenado</strong><p>{error}</p></div>
          <div>
            {selectedFile && <Button type="button" variant="secondary" icon={<RotateCcw size={15} />} onClick={() => void analyze(selectedFile)}>Reintentar</Button>}
            <Button type="button" variant="ghost" icon={<X size={15} />} onClick={clearAnalysis}>Limpiar</Button>
          </div>
        </div>
      )}

      {status === 'complete' && result && selectedFile && (
        <div className="prefill-result">
          <div className="prefill-result__top">
            <span className="prefill-result__success"><CheckCircle2 size={21} /></span>
            <div>
              <span className="prefill-result__file"><FileText size={13} /> {applicationPrefillFileName(result)} · {applied ? 'Fuente del prellenado' : 'Documento analizado'}</span>
              <h5>{applied ? 'Campos aplicados al formulario' : 'Extracción lista para tu confirmación'}</h5>
              <p>{applicationPrefillSummary(result)}</p>
            </div>
            <div className="prefill-result__actions">
              <Button type="button" variant="secondary" icon={<RotateCcw size={15} />} onClick={() => void analyze(selectedFile)}>Analizar nuevamente</Button>
              <Button type="button" variant="ghost" icon={<X size={15} />} onClick={clearAnalysis}>Limpiar análisis</Button>
            </div>
          </div>

          <div className="prefill-result__metrics" aria-label="Resumen de extracción">
            <div><strong>{extractedCount}</strong><span>Campos identificados</span></div>
            <div><strong>{averageConfidence}%</strong><span>Confianza promedio</span></div>
            <div className={lowConfidenceCount ? 'has-warning' : ''}><strong>{lowConfidenceCount}</strong><span>Campos por revisar</span></div>
            <div><strong>{applicationPrefillProviderLabel(result.provider)}</strong><span>{result.provider.toLowerCase().includes('gemini') ? 'Procesamiento con Gemini' : result.configured ? 'Muestra reconocida localmente' : 'Análisis local de contingencia'}</span></div>
          </div>

          {(lowConfidenceCount > 0 || result.warnings.length > 0) && (
            <div className="prefill-warnings" role="note">
              <AlertTriangle size={17} />
              <div>
                <strong>Revisión recomendada</strong>
                <p>{lowConfidenceCount > 0 ? `${lowConfidenceCount} campo(s) tienen confianza menor al 75 %. ` : ''}{result.warnings.join(' ')}</p>
              </div>
            </div>
          )}

          <div className="prefill-fields">
            <header><div><h5>Selecciona los datos que deseas aplicar</h5><p>La evidencia permite comprobar cada valor. Los datos críticos y de baja confianza empiezan desmarcados.</p></div><Badge tone="info">Confirmación humana</Badge></header>
            <div className="prefill-fields__list">
              {result.fields.map((field) => {
                const lowConfidence = isLowConfidenceField(field);
                const confidence = normalizeConfidence(field.confidence);
                const supported = isApplicationPrefillFieldSupported(field.path);
                const critical = applicationPrefillCriticalPaths.has(field.path);
                return (
                  <article className={lowConfidence ? 'is-low-confidence' : ''} key={`${field.path}-${field.page}`}>
                    <label className="prefill-field__selector" title={supported ? 'Incluir este dato en el formulario' : 'Este dato no corresponde a un campo editable de la solicitud'}>
                      <input type="checkbox" checked={selectedPaths.has(field.path)} disabled={!supported || field.value === null || field.value === ''} onChange={() => toggleField(field.path)} />
                      <span className="sr-only">Incluir {field.label}</span>
                    </label>
                    <div className="prefill-field__value">
                      <span>{field.label}{critical && <em>Confirmación requerida</em>}</span>
                      <strong>{displayValue(field.value)}</strong>
                    </div>
                    <div className="prefill-field__confidence">
                      <span><small>{applicationPrefillStatusLabel(field.status)}</small><b>{confidence}%</b></span>
                      <i><em style={{ width: `${confidence}%` }} /></i>
                    </div>
                    <div className="prefill-field__evidence">
                      <small>Página {field.page || 1}</small>
                      <q>{field.evidence || 'Sin fragmento de evidencia disponible.'}</q>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="prefill-fields__footer">
              <div>
                <strong>{selectedPaths.size} campo(s) seleccionado(s)</strong>
                <p>Al aplicar, los campos no seleccionados quedarán vacíos para evitar mezclar datos de solicitudes distintas.</p>
              </div>
              <Button type="button" variant="success" disabled={selectedPaths.size === 0} icon={<CheckCircle2 size={16} />} onClick={applySelected}>
                {applied ? 'Actualizar formulario' : 'Aplicar al formulario'}
              </Button>
            </footer>
          </div>

          <div className="prefill-disclaimer">
            <ShieldCheck size={17} />
            <p><strong>Control humano obligatorio.</strong> {result.disclaimer || 'La extracción propone datos, pero no aprueba la solicitud ni sustituye la revisión del asesor.'}</p>
          </div>
        </div>
      )}
    </section>
  );
}
