import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  FileCheck2,
  FileText,
  Info,
  Landmark,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { CaseDetail, CreateCaseInput } from '../types';
import { applyApplicationPrefill } from '../applicationPrefill';
import { runConcurrentQueue } from '../concurrentQueue';
import { documentFormatLabel, inferDocumentType, supportedDocument } from '../documentClassification';
import { createBlankCaseForm } from '../newCaseForm';
import { formatCurrency } from '../utils';
import { Badge, Button } from '../components/ui';
import ApplicationPrefillPanel from '../components/ApplicationPrefillPanel';

const steps = [
  { label: 'Cliente', icon: UserRound },
  { label: 'Plan y aporte', icon: Landmark },
  { label: 'Documentos', icon: FileText },
  { label: 'Confirmación', icon: CheckCircle2 },
];

const standardDemoForm: CreateCaseInput = {
  agency: 'Agencia Centro · Demostración',
  advisor: 'Asesor de sucursal',
  client: {
    fullName: 'Andrea Rivera · Cliente de demostración',
    idType: 'DNI',
    idNumber: '0000-0000-00000',
    nationality: 'Hondureña',
    residenceCountry: 'Honduras',
    city: 'Tegucigalpa',
  },
  product: {
    plan: 'Plan Individual de Pensiones',
    currency: 'HNL',
    contributionAmount: 750,
    frequency: 'Mensual',
    paymentMethod: 'Débito a cuenta',
    sourceOfFunds: 'Remuneración salarial',
  },
  scenario: 'standard',
};

interface PendingDocumentUpload {
  file: File;
  type: string;
}

interface UploadProgress {
  completed: number;
  failed: number;
  total: number;
}

export default function NewCasePage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CreateCaseInput>(() => createBlankCaseForm());
  const [files, setFiles] = useState<File[]>([]);
  const [prefillSourceFile, setPrefillSourceFile] = useState<File | null>(null);
  const [prefillResetKey, setPrefillResetKey] = useState(0);
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdCase, setCreatedCase] = useState<CaseDetail | null>(null);
  const [failedUploads, setFailedUploads] = useState<PendingDocumentUpload[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const updateClient = (key: keyof CreateCaseInput['client'], value: string) => {
    setForm((current) => ({ ...current, client: { ...current.client, [key]: value } }));
  };

  const updateProduct = (key: keyof CreateCaseInput['product'], value: string | number) => {
    setForm((current) => ({ ...current, product: { ...current.product, [key]: value } }));
  };

  const currentValid = useMemo(() => {
    if (step === 0) return Boolean(form.client.fullName && form.client.idNumber && form.agency && form.client.city);
    if (step === 1) {
      return form.product.contributionAmount > 0
        && Boolean(form.product.plan && form.product.currency && form.product.frequency && form.product.paymentMethod && form.product.sourceOfFunds && form.scenario);
    }
    if (step === 2) return syntheticConfirmed;
    return true;
  }, [form, step, syntheticConfirmed]);

  const loadScenario = (scenario: 'standard' | 'compliance') => {
    setPrefillSourceFile(null);
    setPrefillResetKey((current) => current + 1);
    if (scenario === 'standard') {
      setForm(standardDemoForm);
    } else {
      setForm({
        ...standardDemoForm,
        client: { ...standardDemoForm.client, fullName: 'Mario Castillo · Cliente de demostración' },
        product: {
          ...standardDemoForm.product,
          contributionAmount: 2500,
          sourceOfFunds: 'Ingresos por servicios profesionales',
          paymentMethod: 'Transferencia bancaria',
        },
        scenario: 'compliance',
      });
    }
  };

  const uploadDocuments = async (caseId: string, uploads: PendingDocumentUpload[]) => {
    setUploadProgress({ completed: 0, failed: 0, total: uploads.length });
    let failureCount = 0;
    const results = await runConcurrentQueue(
      uploads,
      (upload) => api.uploadDocument(caseId, upload.file, upload.type),
      {
        concurrency: 3,
        onSettled: (result, completed, total) => {
          if (result.status === 'rejected') failureCount += 1;
          setUploadProgress({
            completed,
            failed: failureCount,
            total,
          });
        },
      },
    );
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.item);
    setFailedUploads(failures);
    setUploadProgress({ completed: uploads.length, failed: failures.length, total: uploads.length });
    return failures;
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    setFailedUploads([]);
    setUploadProgress(null);
    try {
      const created = await api.createCase(form);
      setCreatedCase(created);
      const uploads: PendingDocumentUpload[] = [
        ...(prefillSourceFile ? [{ file: prefillSourceFile, type: 'AFFILIATION_FORM' }] : []),
        ...files.map((file) => ({ file, type: inferDocumentType(file.name) })),
      ];
      const failures = await uploadDocuments(created.id, uploads);
      if (failures.length > 0) {
        setError(`${uploads.length - failures.length} de ${uploads.length} documentos se cargaron correctamente. Reintenta únicamente los ${failures.length} pendientes.`);
        return;
      }
      navigate(`/casos/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible crear el expediente.');
    } finally {
      setSubmitting(false);
    }
  };

  const retryFailedUploads = async () => {
    if (!createdCase || failedUploads.length === 0) return;
    setSubmitting(true);
    setError('');
    const retrying = [...failedUploads];
    try {
      const failures = await uploadDocuments(createdCase.id, retrying);
      if (failures.length > 0) {
        setError(`${retrying.length - failures.length} de ${retrying.length} documentos pendientes se cargaron. Aún quedan ${failures.length} por reintentar.`);
        return;
      }
      navigate(`/casos/${createdCase.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible completar la carga pendiente.');
    } finally {
      setSubmitting(false);
    }
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFiles((current) => {
      const candidates = Array.from(incoming).filter((file) => {
        const isPrefillSource = prefillSourceFile
          && file.name === prefillSourceFile.name
          && file.size === prefillSourceFile.size;
        const alreadyAdded = current.some((item) => item.name === file.name && item.size === file.size);
        return supportedDocument(file) && file.size <= 10 * 1024 * 1024 && !isPrefillSource && !alreadyAdded;
      });
      return [...current, ...candidates];
    });
  };

  return (
    <div className="new-case-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Captura asistida</div>
          <h2>Nueva solicitud de afiliación</h2>
          <p>Los datos se capturan una vez y se reutilizan en todo el expediente.</p>
        </div>
        <Badge tone="info"><ShieldCheck size={14} /> Solo datos sintéticos</Badge>
      </section>

      <div className="wizard-layout">
        <aside className="wizard-sidebar">
          <div className="wizard-progress">
            {steps.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  className={`${index === step ? 'is-active' : ''} ${index < step ? 'is-complete' : ''}`}
                  disabled={index > step}
                  onClick={() => index <= step && setStep(index)}
                  key={item.label}
                >
                  <i>{index < step ? <Check size={17} /> : <Icon size={18} />}</i>
                  <span><small>Paso {index + 1}</small><strong>{item.label}</strong></span>
                </button>
              );
            })}
          </div>
          <div className="scenario-card">
            <Sparkles size={19} />
            <strong>Escenarios de la demostración</strong>
            <p>Carga una historia preconfigurada y modifícala si lo deseas.</p>
            <button type="button" className={form.scenario === 'standard' ? 'is-active' : ''} onClick={() => loadScenario('standard')}>Caso estándar</button>
            <button type="button" className={form.scenario === 'compliance' ? 'is-active' : ''} onClick={() => loadScenario('compliance')}>Ruta Cumplimiento</button>
          </div>
        </aside>

        <form className="wizard-card" onSubmit={(event) => { event.preventDefault(); if (step === 3) void submit(); }}>
          <header className="wizard-card__header">
            <div><span>Paso {step + 1} de {steps.length}</span><h3>{steps[step].label}</h3></div>
            <div className="wizard-card__meter"><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
          </header>

          <div className="wizard-card__body">
            <div className="form-section" hidden={step !== 0}>
                <ApplicationPrefillPanel
                  key={prefillResetKey}
                  onApply={(patch) => setForm(applyApplicationPrefill(createBlankCaseForm(), patch))}
                  onDocumentReady={(file) => {
                    setPrefillSourceFile(file);
                    setFiles((current) => current.filter((item) => item.name !== file.name || item.size !== file.size));
                  }}
                  onClear={() => {
                    if (prefillSourceFile) setForm(createBlankCaseForm());
                    setPrefillSourceFile(null);
                  }}
                />
                <div className="section-heading"><span><UserRound size={19} /></span><div><h4>Identificación del cliente</h4><p>Información mínima para iniciar la solicitud.</p></div></div>
                <div className="form-grid">
                  <label className="field field--wide"><span>Nombre completo <b>*</b></span><input value={form.client.fullName} onChange={(event) => updateClient('fullName', event.target.value)} required /></label>
                  <label className="field"><span>Tipo de identificación</span><select value={form.client.idType} onChange={(event) => updateClient('idType', event.target.value)}><option value="">Seleccione</option>{!['DNI', 'Pasaporte', 'Carnet de residencia', ''].includes(form.client.idType) && <option>{form.client.idType}</option>}<option>DNI</option><option>Pasaporte</option><option>Carnet de residencia</option></select></label>
                  <label className="field"><span>Número de identificación <b>*</b></span><input value={form.client.idNumber} onChange={(event) => updateClient('idNumber', event.target.value)} required /></label>
                  <label className="field"><span>Nacionalidad</span><input value={form.client.nationality} onChange={(event) => updateClient('nationality', event.target.value)} /></label>
                  <label className="field"><span>País de residencia</span><input value={form.client.residenceCountry} onChange={(event) => updateClient('residenceCountry', event.target.value)} /></label>
                  <label className="field"><span>Ciudad <b>*</b></span><input value={form.client.city} onChange={(event) => updateClient('city', event.target.value)} required /></label>
                  <label className="field"><span>Agencia</span><select value={form.agency} onChange={(event) => setForm((current) => ({ ...current, agency: event.target.value }))}><option value="">Seleccione</option>{!['Agencia Centro · Demostración', 'Agencia Próceres · Demostración', 'Agencia San Pedro · Demostración', ''].includes(form.agency) && <option>{form.agency}</option>}<option>Agencia Centro · Demostración</option><option>Agencia Próceres · Demostración</option><option>Agencia San Pedro · Demostración</option></select></label>
                  <label className="field field--wide"><span>Asesor de origen</span><input value={form.advisor} onChange={(event) => setForm((current) => ({ ...current, advisor: event.target.value }))} /></label>
                </div>
                <div className="form-hint"><Info size={17} /><span>La identificación será enmascarada automáticamente al mostrarse en pantalla.</span></div>
            </div>

            {step === 1 && (
              <div className="form-section">
                <div className="section-heading"><span><Landmark size={19} /></span><div><h4>Plan y procedencia del aporte</h4><p>Define el producto y la ruta inicial de análisis.</p></div></div>
                <div className="form-grid">
                  <label className="field field--wide"><span>Producto</span><select value={form.product.plan} onChange={(event) => updateProduct('plan', event.target.value)}><option value="">Seleccione</option>{!['Plan Individual de Pensiones', ''].includes(form.product.plan) && <option>{form.product.plan}</option>}<option>Plan Individual de Pensiones</option></select></label>
                  <label className="field"><span>Moneda</span><select value={form.product.currency} onChange={(event) => updateProduct('currency', event.target.value)}><option value="">Seleccione</option>{!['HNL', 'USD', ''].includes(form.product.currency) && <option>{form.product.currency}</option>}<option value="HNL">Lempiras (HNL)</option><option value="USD">Dólares (USD)</option></select></label>
                  <label className="field"><span>Monto del aporte <b>*</b></span><div className="money-input"><span>{form.product.currency === 'USD' ? '$' : form.product.currency === 'HNL' ? 'L' : '—'}</span><input type="number" min="1" value={form.product.contributionAmount || ''} onChange={(event) => updateProduct('contributionAmount', Number(event.target.value))} required /></div></label>
                  <label className="field"><span>Frecuencia</span><select value={form.product.frequency} onChange={(event) => updateProduct('frequency', event.target.value)}><option value="">Seleccione</option>{!['Mensual', 'Aporte único', 'Trimestral', ''].includes(form.product.frequency) && <option>{form.product.frequency}</option>}<option>Mensual</option><option>Aporte único</option><option>Trimestral</option></select></label>
                  <label className="field"><span>Forma de pago</span><select value={form.product.paymentMethod} onChange={(event) => updateProduct('paymentMethod', event.target.value)}><option value="">Seleccione</option>{!['Débito a cuenta', 'Transferencia bancaria', 'Tarjeta de crédito', ''].includes(form.product.paymentMethod) && <option>{form.product.paymentMethod}</option>}<option>Débito a cuenta</option><option>Transferencia bancaria</option><option>Tarjeta de crédito</option></select></label>
                  <label className="field field--wide"><span>Procedencia de fondos <b>*</b></span><select value={form.product.sourceOfFunds} onChange={(event) => updateProduct('sourceOfFunds', event.target.value)}><option value="">Seleccione</option>{!['Remuneración salarial', 'Ingresos por servicios profesionales', 'Venta de bienes', 'Ahorros acumulados', 'Remesas', 'Prestaciones laborales', 'Otros', ''].includes(form.product.sourceOfFunds) && <option>{form.product.sourceOfFunds}</option>}<option>Remuneración salarial</option><option>Ingresos por servicios profesionales</option><option>Venta de bienes</option><option>Ahorros acumulados</option><option>Remesas</option><option>Prestaciones laborales</option><option>Otros</option></select></label>
                </div>
                <div className={`route-preview ${form.scenario === 'compliance' ? 'route-preview--warning' : ''}`}>
                  <div><BriefcaseBusiness size={19} /><span><small>Ruta preliminar</small><strong>{form.scenario === 'compliance' ? 'Revisión reforzada · Cumplimiento' : form.scenario === 'standard' ? 'Control de Calidad estándar' : 'Pendiente de confirmación'}</strong></span></div>
                  <Badge tone={form.scenario === 'compliance' ? 'warning' : form.scenario === 'standard' ? 'success' : 'neutral'}>{form.scenario === 'compliance' ? 'Riesgo medio' : form.scenario === 'standard' ? 'Riesgo bajo' : 'Pendiente'}</Badge>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="form-section">
                <div className="section-heading"><span><FileText size={19} /></span><div><h4>Documentación de soporte</h4><p>El portal clasifica los archivos por su nombre y conserva la fuente para revisión.</p></div></div>
                <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,text/plain,.pdf,.png,.jpg,.jpeg,.txt" multiple hidden onChange={(event) => addFiles(event.target.files)} />
                <button
                  className="upload-zone"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
                >
                  <span><UploadCloud size={26} /></span>
                  <strong>Arrastra los documentos o haz clic para seleccionar</strong>
                  <small>PDF, JPG, PNG o TXT · máximo 10 MB por archivo</small>
                </button>
                {prefillSourceFile && (
                  <div className="upload-list upload-list--prefill-source">
                    <div><FileCheck2 size={18} /><span><strong>{prefillSourceFile.name}</strong><small>{(prefillSourceFile.size / 1024 / 1024).toFixed(2)} MB · Fuente del prellenado · Solicitud de afiliación</small></span><Badge tone="purple">Adjunto automático</Badge></div>
                  </div>
                )}
                {files.length > 0 && (
                  <div className="upload-list">
                    {files.map((file, index) => (
                      <div key={`${file.name}-${index}`}><FileCheck2 size={18} /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · {documentFormatLabel(file)} · {inferDocumentType(file.name) === 'OTHER' ? 'Clasificación pendiente' : 'Clasificación sugerida'}</small></span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => index !== itemIndex))} aria-label={`Quitar ${file.name}`}><X size={17} /></button></div>
                    ))}
                  </div>
                )}
                <label className="check-card">
                  <input type="checkbox" checked={syntheticConfirmed} onChange={(event) => setSyntheticConfirmed(event.target.checked)} />
                  <span><strong>Confirmo que cuento con autorización para usar este expediente en la demostración</strong><small>Los archivos se guardan únicamente en este portal local. El prellenado con Gemini requiere autorización separada.</small></span>
                </label>
              </div>
            )}

            {step === 3 && (
              <div className="form-section">
                <div className="section-heading"><span><CheckCircle2 size={19} /></span><div><h4>Revisa y crea el expediente</h4><p>El motor de reglas se ejecutará inmediatamente después.</p></div></div>
                <div className="review-grid">
                  <section><header><UserRound size={18} /><h5>Cliente</h5><button type="button" onClick={() => setStep(0)}>Editar</button></header><dl><div><dt>Nombre</dt><dd>{form.client.fullName}</dd></div><div><dt>Identificación</dt><dd>{form.client.idType} · ••••{form.client.idNumber.slice(-4)}</dd></div><div><dt>Ubicación</dt><dd>{form.client.city}, {form.client.residenceCountry}</dd></div><div><dt>Origen</dt><dd>{form.agency}</dd></div></dl></section>
                  <section><header><Landmark size={18} /><h5>Plan y aporte</h5><button type="button" onClick={() => setStep(1)}>Editar</button></header><dl><div><dt>Producto</dt><dd>{form.product.plan}</dd></div><div><dt>Aporte</dt><dd>{formatCurrency(form.product.contributionAmount, form.product.currency)} · {form.product.frequency}</dd></div><div><dt>Procedencia</dt><dd>{form.product.sourceOfFunds}</dd></div><div><dt>Pago</dt><dd>{form.product.paymentMethod}</dd></div></dl></section>
                  <section className="review-grid__wide"><header><FileText size={18} /><h5>Documentación</h5><button type="button" onClick={() => setStep(2)}>Editar</button></header><p>{prefillSourceFile ? `La fuente del prellenado se adjuntará como solicitud de afiliación${files.length ? ` junto con ${files.length} documento(s) adicional(es)` : ''}.` : files.length ? `${files.length} archivo(s) se cargarán y clasificarán en el expediente.` : 'El escenario generará el paquete documental base de la demostración.'}</p></section>
                </div>
                <div className="next-process"><Sparkles size={21} /><div><strong>¿Qué ocurrirá después?</strong><p>Clasificaremos los documentos, validaremos campos obligatorios y mostraremos cualquier alerta con su evidencia. Ninguna aprobación será automática.</p></div></div>
              </div>
            )}
          </div>

          {uploadProgress && uploadProgress.total > 0 && (
            <div className={`document-upload-progress ${uploadProgress.failed ? 'document-upload-progress--warning' : ''}`} role="status" aria-live="polite">
              <div>
                <UploadCloud size={18} />
                <span>
                  <strong>{uploadProgress.completed < uploadProgress.total ? 'Cargando documentos en paralelo…' : uploadProgress.failed ? 'Carga completada con pendientes' : 'Documentos cargados'}</strong>
                  <small>{uploadProgress.completed} de {uploadProgress.total} procesados{uploadProgress.failed ? ` · ${uploadProgress.failed} pendientes` : ''}</small>
                </span>
                <b>{Math.round((uploadProgress.completed / uploadProgress.total) * 100)}%</b>
              </div>
              <i><span style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }} /></i>
            </div>
          )}

          {error && (
            <div className="form-error" role="alert">
              <span>{error}</span>
              {createdCase && (
                <div className="form-error__actions">
                  {failedUploads.length > 0 && <button type="button" disabled={submitting} onClick={() => void retryFailedUploads()}>Reintentar pendientes</button>}
                  <button type="button" onClick={() => navigate(`/casos/${createdCase.id}`)}>Abrir el caso creado</button>
                </div>
              )}
            </div>
          )}

          <footer className="wizard-card__footer">
            <Button type="button" variant="ghost" icon={<ArrowLeft size={17} />} disabled={step === 0 || submitting} onClick={() => setStep((current) => current - 1)}>Anterior</Button>
            {step < 3 ? (
              <Button type="button" icon={<ArrowRight size={17} />} disabled={!currentValid} onClick={() => setStep((current) => current + 1)}>Continuar</Button>
            ) : (
              <Button type="submit" variant="success" icon={<CheckCircle2 size={17} />} loading={submitting} disabled={Boolean(createdCase)}>Crear y prevalidar expediente</Button>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}
