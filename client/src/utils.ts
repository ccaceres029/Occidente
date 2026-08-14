export const formatDate = (value?: string, withTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-HN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
};

export const formatCurrency = (value?: number, currency = 'HNL') =>
  new Intl.NumberFormat('es-HN', {
    style: 'currency',
    currency: currency === 'USD' || currency === 'Dólares' ? 'USD' : 'HNL',
    maximumFractionDigits: 2,
  }).format(value || 0);

const documentTypeLabels: Record<string, string> = {
  AFFILIATION_FORM: 'Formulario de afiliación',
  IDENTITY: 'Documento de identidad',
  RTN: 'Registro tributario nacional',
  CONTRIBUTION_RECEIPT: 'Comprobante de aporte',
  FINANCIAL_EDUCATION: 'Constancia de educación financiera',
  FATCA: 'Autocertificación fiscal FATCA',
  CONTRACT: 'Contrato de afiliación',
  SOURCE_OF_FUNDS: 'Respaldo de procedencia de fondos',
  SCREENING: 'Listas y cautelas',
  EMAIL_CHECKLIST: 'Correo de remisión y lista de verificación',
  FORM: 'Formulario',
  DOCUMENT_COMPLETENESS: 'Integridad documental',
  OTRO: 'Otro documento',
};

const stateLabels: Record<string, string> = {
  VALID: 'Válido',
  WARNING: 'Con alerta',
  UPLOADED: 'Cargado',
  OBSERVED: 'Observado',
  EXTRACTED: 'Extraído',
  CONFLICT: 'Con diferencia',
  CONFIRMED: 'Extraído',
  MATCH: 'Coincide',
  MISMATCH: 'Diferencia',
  MISSING: 'Faltante',
  REVIEW: 'Revisar',
  PASS: 'Superado',
  FAIL: 'No superado',
  PENDING: 'Pendiente',
  RUNNING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'No completado',
  ALIGNED: 'Alineado',
  CONSISTENT: 'Coherente',
  INSUFFICIENT: 'Insuficiente',
};

const riskRouteLabels: Record<string, string> = {
  REVISION_ESTANDAR: 'Revisión estándar',
  REVISION_REFORZADA: 'Revisión reforzada',
  CUMPLIMIENTO: 'Cumplimiento',
  ESCALADO_CUMPLIMIENTO: 'En Cumplimiento',
  ESCALATE_COMPLIANCE: 'Escalar a Cumplimiento',
  SUBSANATE: 'Subsanar antes de continuar',
  HUMAN_REVIEW: 'Revisión humana requerida',
  CONTINUE_STANDARD_REVIEW: 'Continuar revisión estándar',
  READY_CORE: 'Listo para sistema central',
};

const ruleCodeLabels: Record<string, string> = {
  EDUCATION_YEAR_REQUIRED: 'Año de educación financiera obligatorio',
  ADDRESS_MISMATCH: 'Diferencia de domicilio',
  FATCA_POSITIVE: 'Indicador fiscal FATCA positivo',
  SOURCE_DECLARED: 'Procedencia declarada',
  AMOUNT_PROFILE: 'Monto frente al perfil',
  EVIDENCE_LINKED: 'Evidencia vinculada',
};

const fieldPathLabels: Record<string, string> = {
  'facts.educationFinancialYear': 'Año de educación financiera',
  'client.city': 'Ciudad o domicilio',
  'client.fullName': 'Nombre completo',
  'client.idNumber': 'Número de identificación',
  'product.contributionAmount': 'Monto del aporte',
  'product.sourceOfFunds': 'Procedencia de fondos',
  'education.year': 'Año de educación financiera',
};

export const documentTypeLabel = (value?: string) => {
  if (!value) return 'Documento';
  return documentTypeLabels[value.toUpperCase()] || spanishDynamicText(value.replaceAll('_', ' '));
};

export const identityTypeLabel = (value?: string) => {
  const labels: Record<string, string> = {
    DNI: 'DNI',
    PASSPORT: 'Pasaporte',
    PASAPORTE: 'Pasaporte',
    RESIDENCE_CARD: 'Carné de residencia',
    CARNET_DE_RESIDENCIA: 'Carné de residencia',
    CARNÉ_DE_RESIDENCIA: 'Carné de residencia',
  };
  return labels[(value || '').toUpperCase().replaceAll(' ', '_')] || 'Identificación';
};

export const stateLabel = (value?: string) => {
  if (!value) return 'Sin estado';
  return stateLabels[value.toUpperCase()] || spanishDynamicText(value.replaceAll('_', ' '));
};

export const riskLevelLabel = (value?: string) => {
  const labels: Record<string, string> = { HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo', ALTO: 'Alto', MEDIO: 'Medio', BAJO: 'Bajo' };
  return labels[(value || '').toUpperCase()] || spanishDynamicText(value || 'Sin nivel');
};

export const riskRouteLabel = (value?: string) => {
  if (!value) return 'Sin ruta asignada';
  return riskRouteLabels[value.toUpperCase()] || spanishDynamicText(value.replaceAll('_', ' '));
};

export const ruleCodeLabel = (value?: string) => {
  if (!value) return 'Regla documental';
  return ruleCodeLabels[value.toUpperCase()] || 'Regla documental';
};

export const fieldPathLabel = (value?: string) => {
  if (!value) return 'Campo relacionado';
  return fieldPathLabels[value] || 'Campo relacionado';
};

export const formatEvidenceValue = (value: unknown) => {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value === null || value === undefined || value === '') return 'No identificado';
  return spanishDynamicText(String(value));
};

export function spanishDynamicText(value: string) {
  const replacements: Array<[RegExp, string]> = [
    [/CORE_AFPC_DEMO/g, 'Sistema central AFPC de demostración'],
    [/ESCALATE_COMPLIANCE/g, 'Escalar a Cumplimiento'],
    [/CONTINUE_STANDARD_REVIEW/g, 'Continuar revisión estándar'],
    [/PROFESSIONAL_SERVICES/g, 'Servicios profesionales'],
    [/REVISION_ESTANDAR/g, 'Revisión estándar'],
    [/REVISION_REFORZADA/g, 'Revisión reforzada'],
    [/HUMAN_REVIEW/g, 'Revisión humana'],
    [/SUBSANATE/g, 'Subsanar'],
    [/\bCONTINUE\b/g, 'Continuar'],
    [/\bSALARY\b/g, 'Remuneración salarial'],
    [/ASSET_SALE/g, 'Venta de bienes'],
    [/\bSAVINGS\b/g, 'Ahorros'],
    [/\bREMITTANCES\b/g, 'Remesas'],
    [/EMPLOYMENT_BENEFITS/g, 'Prestaciones laborales'],
    [/\bOTHER\b/g, 'Otros'],
    [/\bCLEAR\b/g, 'Sin coincidencias'],
    [/EDUCATION_YEAR_REQUIRED/g, 'Año de educación financiera obligatorio'],
    [/ADDRESS_MISMATCH/g, 'Diferencia de domicilio'],
    [/FATCA_POSITIVE/g, 'Indicador fiscal FATCA positivo'],
    [/SOURCE_OF_FUNDS/g, 'Procedencia de fondos'],
    [/CONTRIBUTION_RECEIPT/g, 'Comprobante de aporte'],
    [/FINANCIAL_EDUCATION/g, 'Educación financiera'],
    [/AFFILIATION_FORM/g, 'Formulario de afiliación'],
    [/EMAIL_CHECKLIST/g, 'Correo y lista de verificación'],
    [/\bIDENTITY\b/g, 'Documento de identidad'],
    [/\bCONTRACT\b/g, 'Contrato'],
    [/\bSCREENING\b/g, 'Listas y cautelas'],
    [/\bMISMATCH\b/g, 'Diferencia'],
    [/\bMATCH\b/g, 'Coincide'],
    [/\bMISSING\b/g, 'Faltante'],
    [/\bREVIEW\b/g, 'Revisar'],
    [/\bEXTRACTED\b/g, 'Extraído'],
    [/LOW_CONFIDENCE/g, 'Confianza baja'],
    [/\bCONFLICT\b/g, 'Con diferencia'],
    [/\bVALID\b/g, 'Válido'],
    [/\bWARNING\b/g, 'Con alerta'],
    [/\bPASS\b/g, 'Superado'],
    [/\bFAIL\b/g, 'No superado'],
    [/\bPENDING\b/g, 'Pendiente'],
    [/\bRUNNING\b/g, 'Procesando'],
    [/\bCOMPLETED\b/g, 'Completado'],
    [/\bFAILED\b/g, 'No completado'],
    [/\bALIGNED\b/g, 'Alineado'],
    [/\bINSUFFICIENT\b/g, 'Insuficiente'],
    [/\btrue\b/gi, 'Sí'],
    [/\bfalse\b/gi, 'No'],
    [/['"]?city['"]?/gi, 'ciudad'],
    [/\bconsistent\b/gi, 'coherente'],
    [/\bscore\b/gi, 'puntaje'],
    [/ready for core/gi, 'listo para sistema central'],
    [/in review/gi, 'en revisión'],
    [/\breceived\b/gi, 'recibido'],
    [/\breturned\b/gi, 'devuelto'],
    [/\bapproved\b/gi, 'aprobado'],
    [/\barchived\b/gi, 'archivado'],
    [/\bcompliance\b/gi, 'Cumplimiento'],
    [/\bpending\b/gi, 'pendiente'],
    [/\bsimulation\b/gi, 'simulación'],
    [/\blocal-fallback\b/gi, 'motor local'],
    [/\bchecklist\b/gi, 'lista de verificación'],
    [/document-pipeline-demo/gi, 'flujo documental de demostración'],
    [/synthetic-canonical-snapshot/gi, 'instantánea canónica sintética'],
    [/template-mapped-canonical-data/gi, 'datos canónicos mapeados por plantilla'],
    [/synthetic-canonical-template/gi, 'plantilla canónica sintética'],
    [/seed-synthetic-metadata/gi, 'metadatos sintéticos precargados'],
    [/uploaded-synthetic-metadata/gi, 'metadatos sintéticos adjuntados'],
    [/synthetic-template/gi, 'plantilla sintética'],
    [/metadata-inference/gi, 'inferencia por metadatos'],
    [/\bupright\b/gi, 'vertical'],
    [/\brotated\b/gi, 'rotado'],
    [/\bunknown\b/gi, 'desconocido'],
    [/source-of-funds/gi, 'procedencia de fondos'],
    [/transaction-profile/gi, 'perfil transaccional'],
    [/document-quality/gi, 'calidad documental'],
    [/\bcompleteness\b/gi, 'integridad'],
    [/\bconsistency\b/gi, 'consistencia'],
    [/\bregulatory\b/gi, 'regulatorio'],
    [/AFP-DEMO/gi, 'AFP-PRUEBA'],
    [/Cliente Demo/gi, 'Cliente de demostración'],
    [/Asesor Demo/gi, 'Asesor de demostración'],
    [/\(demo\)/gi, '(demostración)'],
    [/· Demo\b/gi, '· Demostración'],
    [/\bdemo\b/gi, 'demostración'],
  ];
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

const payloadKeyLabels: Record<string, string> = {
  analysis: 'análisis',
  id: 'identificador',
  fingerprint: 'huella',
  engineVersion: 'versiónDelMotor',
  generatedAt: 'generadoEl',
  provider: 'motor',
  configured: 'configurado',
  cached: 'resultadoAlmacenado',
  syntheticOnly: 'soloDatosSintéticos',
  mode: 'modo',
  dataOrigin: 'origenDeDatos',
  extractionMethod: 'métodoDeExtracción',
  notOcrNotice: 'avisoDeLecturaDocumental',
  confidenceNotice: 'avisoDeConfianza',
  pipeline: 'flujoDeAnálisis',
  label: 'etiqueta',
  status: 'estado',
  durationMs: 'duraciónEnMilisegundos',
  itemsProcessed: 'elementosProcesados',
  executiveSummary: 'resumenEjecutivo',
  metrics: 'métricas',
  documentsProcessed: 'documentosProcesados',
  fieldsExtracted: 'camposExtraídos',
  averageConfidence: 'confianzaPromedio',
  consistencyRate: 'tasaDeConsistencia',
  anomaliesDetected: 'anomalíasDetectadas',
  estimatedManualMinutes: 'minutosManualesEstimados',
  estimatedAutomatedSeconds: 'segundosAutomatizadosEstimados',
  estimatedMinutesSaved: 'minutosAhorradosEstimados',
  documents: 'documentos',
  documentId: 'identificadorDelDocumento',
  name: 'nombre',
  predictedType: 'tipoIdentificado',
  confidence: 'confianza',
  method: 'método',
  source: 'origen',
  contentUrl: 'rutaDelDocumento',
  pages: 'páginas',
  quality: 'calidad',
  readability: 'legibilidad',
  completeness: 'integridad',
  orientation: 'orientación',
  extractedFields: 'camposExtraídos',
  documentType: 'tipoDeDocumento',
  field: 'campo',
  value: 'valor',
  page: 'página',
  evidence: 'evidencia',
  boundingBox: 'regiónEnLaPágina',
  width: 'ancho',
  height: 'alto',
  origin: 'origen',
  consistency: 'consistencia',
  verdict: 'resultado',
  explanation: 'explicación',
  sources: 'fuentes',
  anomalies: 'anomalías',
  severity: 'severidad',
  category: 'categoría',
  title: 'título',
  evidenceRefs: 'referenciasDeEvidencia',
  suggestedAction: 'acciónSugerida',
  ruleCode: 'regla',
  declaredSource: 'procedenciaDeclarada',
  normalizedCategory: 'categoríaNormalizada',
  amount: 'monto',
  alignment: 'alineación',
  evidenceDocuments: 'documentosDeEvidencia',
  checks: 'comprobaciones',
  code: 'código',
  reason: 'motivo',
  policyRef: 'referenciaDePolítica',
  recommendation: 'recomendación',
  decision: 'decisión',
  humanDecisionRequired: 'decisiónHumanaObligatoria',
  rationale: 'fundamentos',
  nextSteps: 'próximosPasos',
  order: 'orden',
  owner: 'responsable',
  action: 'acción',
  demoMasked: 'datosEnmascaradosDeDemostración',
  requestReference: 'referenciaDeSolicitud',
  customer: 'cliente',
  fullName: 'nombreCompleto',
  identificationType: 'tipoDeIdentificación',
  identification: 'identificación',
  nationality: 'nacionalidad',
  countryOfResidence: 'paísDeResidencia',
  city: 'ciudad',
  affiliation: 'afiliación',
  plan: 'plan',
  currency: 'moneda',
  contributionAmount: 'montoDelAporte',
  frequency: 'frecuencia',
  paymentMethod: 'formaDePago',
  sourceOfFunds: 'procedenciaDeFondos',
  controls: 'controles',
  riskLevel: 'nivelDeRiesgo',
  riskScore: 'puntajeDeRiesgo',
  route: 'ruta',
  fatcaPositive: 'indicadorFiscalFATCAPositivo',
  identityVerified: 'identidadVerificada',
  beneficiaryPercentTotal: 'porcentajeTotalDeBeneficiarios',
};

export const payloadForDisplay = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(payloadForDisplay);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [payloadKeyLabels[key] || key, payloadForDisplay(item)]));
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string') return spanishDynamicText(value);
  return value;
};

export const relativeAge = (hours?: number) => {
  if (hours === undefined) return 'Sin registro';
  if (hours < 1) return 'Hace menos de 1 h';
  if (hours < 24) return `Hace ${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
};

export const statusTone = (status?: string) => {
  const normalized = (status || '').toLowerCase();
  if (normalized.includes('return') || normalized.includes('devuel')) return 'danger';
  if (normalized.includes('compliance') || normalized.includes('cumpl')) return 'warning';
  if (normalized.includes('ready') || normalized.includes('core') || normalized.includes('approv') || normalized.includes('aprob') || normalized.includes('correg')) return 'success';
  if (normalized.includes('review') || normalized.includes('revis') || normalized.includes('recibid')) return 'info';
  return 'neutral';
};

export const riskTone = (level?: string) => {
  const normalized = (level || '').toLowerCase();
  if (normalized.includes('alt') || normalized === 'high') return 'danger';
  if (normalized.includes('med') || normalized === 'medium') return 'warning';
  return 'success';
};

export const titleFromStatus = (status?: string, fallback?: string) => {
  const labels: Record<string, string> = {
    received: 'Recibido',
    'in-review': 'En revisión',
    returned: 'Devuelto a agencia',
    compliance: 'En Cumplimiento',
    approved: 'Aprobado',
    'ready-core': 'Listo para sistema central',
    archived: 'Archivado',
    RECIBIDO: 'Recibido',
    EN_REVISION: 'En revisión',
    DEVUELTO: 'Devuelto a agencia',
    CORREGIDO: 'Corregido',
    CUMPLIMIENTO: 'En Cumplimiento',
    ESCALADO_CUMPLIMIENTO: 'En Cumplimiento',
    APROBADO: 'Aprobado',
    LISTO_CORE: 'Listo para sistema central',
    ARCHIVADO: 'Archivado',
  };
  if (labels[status || '']) return labels[status || ''];
  if (fallback) return spanishDynamicText(fallback);
  return 'Estado no reconocido';
};

export const canPerformCaseAction = (
  status: string | undefined,
  canActions: string[] | undefined,
  action: string,
  role = 'AFILIACIONES',
) => {
  if (role === 'AFILIACIONES' && action === 'approve' && status?.toUpperCase() === 'ESCALADO_CUMPLIMIENTO') return false;
  return !canActions || canActions.includes(action);
};
