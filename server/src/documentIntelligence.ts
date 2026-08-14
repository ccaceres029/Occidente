import { createHash } from 'node:crypto';
import type { GeminiConfig } from './config.js';
import type {
  AfpcCase,
  CaseDocument,
  CaseRecommendation,
  ConsistencyCheck,
  DocumentAnomaly,
  DocumentClassification,
  DocumentIntelligenceInsight,
  ExtractedDocumentField,
  SourceOfFundsInsight,
} from './types.js';

export const DOCUMENT_INTELLIGENCE_ENGINE_VERSION = 'document-intelligence-demo-1.2.0';

const DOCUMENT_LABELS: Record<string, string> = {
  AFFILIATION_FORM: 'Formulario de afiliación',
  IDENTITY: 'Documento de identidad',
  RTN: 'Registro Tributario Nacional',
  CONTRIBUTION_RECEIPT: 'Comprobante de aporte',
  FINANCIAL_EDUCATION: 'Constancia de educación financiera',
  FATCA: 'Autocertificación FATCA',
  CONTRACT: 'Contrato de afiliación',
  SOURCE_OF_FUNDS: 'Respaldo de procedencia de fondos',
  SCREENING: 'Resultado de listas y cautelas',
  EMAIL_CHECKLIST: 'Correo de remisión y lista de verificación',
  OTHER: 'Documento complementario',
};

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const quantity = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

const normalizeComparable = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .replaceAll(/[^a-zA-Z0-9]/gu, '')
    .toLocaleLowerCase('es-HN');

export function documentIntelligenceFingerprint(afpcCase: AfpcCase): string {
  const stableSnapshot = {
    engineVersion: DOCUMENT_INTELLIGENCE_ENGINE_VERSION,
    id: afpcCase.id,
    status: afpcCase.status,
    client: afpcCase.client,
    product: afpcCase.product,
    facts: afpcCase.facts,
    risk: afpcCase.risk,
    documents: afpcCase.documents.map((document) => ({
      id: document.id,
      type: document.type,
      status: document.status,
      synthetic: document.synthetic,
      pages: document.pages,
      confidence: document.confidence,
      fieldsExtracted: document.fieldsExtracted,
      size: document.size,
      mimeType: document.mimeType,
      storageKey: document.storageKey,
    })),
    validations: afpcCase.validations.map(({ code, severity, resolved }) => ({
      code,
      severity,
      resolved,
    })),
  };
  return createHash('sha256').update(JSON.stringify(stableSnapshot)).digest('hex');
}

function classifyDocuments(caseId: string, documents: CaseDocument[]): DocumentClassification[] {
  return documents.map((document) => {
    const configuredType = DOCUMENT_LABELS[document.type] ? document.type : 'OTHER';
    const confidence = document.confidence ?? (configuredType === 'OTHER' ? 0.78 : 0.94);
    return {
      documentId: document.id,
      name: document.name,
      predictedType: configuredType,
      label: DOCUMENT_LABELS[configuredType] ?? DOCUMENT_LABELS.OTHER,
      confidence: round(confidence, 3),
      method: configuredType === 'OTHER' ? 'metadata-inference' : 'synthetic-template',
      pages: document.pages ?? 1,
      source: document.storageKey ? 'uploaded-synthetic-metadata' : 'seed-synthetic-metadata',
      contentUrl: `/api/cases/${caseId}/documents/${document.id}/content`,
      quality: {
        readability: round(Math.max(0.72, confidence - 0.02), 3),
        completeness: round(document.status === 'WARNING' ? 0.78 : Math.min(0.99, confidence + 0.01), 3),
        orientation: 'upright',
      },
    };
  });
}

function extractFields(afpcCase: AfpcCase): ExtractedDocumentField[] {
  const fields: ExtractedDocumentField[] = [];
  const documentByType = new Map(afpcCase.documents.map((document) => [document.type, document]));

  const add = (
    documentType: string,
    field: string,
    label: string,
    value: ExtractedDocumentField['value'],
    evidence: string,
    confidence = 0.97,
    page = 1,
    explicitStatus?: ExtractedDocumentField['status'],
  ) => {
    const document = documentByType.get(documentType);
    if (!document) return;
    const status =
      explicitStatus ??
      (value === null || value === ''
        ? 'MISSING'
        : confidence < 0.75
          ? 'LOW_CONFIDENCE'
          : 'EXTRACTED');
    fields.push({
      id: `field-${document.id}-${field}`,
      documentId: document.id,
      documentType,
      field,
      label,
      value,
      confidence: round(confidence, 3),
      page: Math.min(page, document.pages ?? page),
      evidence,
      evidenceLocation: 'unavailable',
      status,
      origin: 'synthetic-canonical-template',
    });
  };

  const client = afpcCase.client;
  const product = afpcCase.product;
  const facts = afpcCase.facts;
  const alternateDemoCity = 'Ciudad Alterna Demo';
  const fatcaCity = facts.addressConsistent ? client.city : alternateDemoCity;
  const maskedTaxId = `RTN-****-${client.idNumberMasked.replaceAll(/[^0-9A-Za-z]/gu, '').slice(-4) || 'DEMO'}`;

  add('AFFILIATION_FORM', 'fullName', 'Nombre completo', client.fullName, `Nombre completo: ${client.fullName}`, 0.986);
  add('AFFILIATION_FORM', 'idNumber', 'Identificación', client.idNumberMasked, `Número de identificación: ${client.idNumberMasked}`, 0.981);
  add('AFFILIATION_FORM', 'nationality', 'Nacionalidad', client.nationality, `Nacionalidad: ${client.nationality}`, 0.972);
  add('AFFILIATION_FORM', 'residenceCountry', 'País de residencia', client.residenceCountry, `Residencia: ${client.residenceCountry}`, 0.968);
  add('AFFILIATION_FORM', 'city', 'Ciudad', client.city, `Municipio/Ciudad: ${client.city}`, 0.961);
  add('AFFILIATION_FORM', 'plan', 'Plan', product.plan, `Plan solicitado: ${product.plan}`, 0.979, 2);
  add('AFFILIATION_FORM', 'contributionAmount', 'Aporte', product.contributionAmount, `Aporte: ${product.currency} ${product.contributionAmount}`, 0.975, 2);
  add('AFFILIATION_FORM', 'sourceOfFunds', 'Procedencia', product.sourceOfFunds, `Procedencia de fondos: ${product.sourceOfFunds}`, 0.956, 2);
  add('AFFILIATION_FORM', 'educationFinancialYear', 'Año de educación financiera', facts.educationFinancialYear ?? null, facts.educationFinancialYear ? `Año: ${facts.educationFinancialYear}` : 'Año: ____', facts.educationFinancialYear ? 0.94 : 0.18, 2);

  add('IDENTITY', 'fullName', 'Nombre completo', client.fullName, `Titular: ${client.fullName}`, 0.992);
  add('IDENTITY', 'idNumber', 'Identificación', client.idNumberMasked, `Identidad: ${client.idNumberMasked}`, 0.994);
  add('IDENTITY', 'nationality', 'Nacionalidad', client.nationality, `Nacionalidad: ${client.nationality}`, 0.982);
  add('IDENTITY', 'city', 'Domicilio', client.city, `Domicilio declarado: ${client.city}`, 0.938);

  add('RTN', 'fullName', 'Nombre del contribuyente', client.fullName, `Contribuyente: ${client.fullName}`, 0.968);
  add('RTN', 'taxId', 'RTN', maskedTaxId, `RTN: ${maskedTaxId}`, 0.982);

  add('CONTRIBUTION_RECEIPT', 'contributionAmount', 'Monto del aporte', product.contributionAmount, `Monto recibido: ${product.currency} ${product.contributionAmount}`, 0.989);
  add('CONTRIBUTION_RECEIPT', 'currency', 'Moneda', product.currency, `Moneda: ${product.currency}`, 0.994);
  add('CONTRIBUTION_RECEIPT', 'sourceOfFunds', 'Concepto', product.sourceOfFunds, `Concepto declarado: ${product.sourceOfFunds}`, 0.918);

  add('FATCA', 'fullName', 'Nombre completo', client.fullName, `Nombre del cliente: ${client.fullName}`, 0.979);
  add('FATCA', 'idNumber', 'Identificación', client.idNumberMasked, `Identificación: ${client.idNumberMasked}`, 0.973);
  add('FATCA', 'residenceCountry', 'País de residencia', client.residenceCountry, `País de residencia: ${client.residenceCountry}`, 0.952);
  add('FATCA', 'city', 'Ciudad de residencia', fatcaCity, `Ciudad declarada en FATCA: ${fatcaCity}`, facts.addressConsistent ? 0.94 : 0.91, 1, facts.addressConsistent ? undefined : 'CONFLICT');
  add('FATCA', 'fatcaPositive', 'Indicador FATCA', facts.fatcaPositive, `Referencia FATCA positiva: ${facts.fatcaPositive ? 'Sí' : 'No'}`, 0.988);

  add('CONTRACT', 'fullName', 'Nombre del afiliado', client.fullName, `EL AFILIADO: ${client.fullName}`, 0.965, 1);
  add('CONTRACT', 'idNumber', 'Identificación', client.idNumberMasked, `Documento de identificación: ${client.idNumberMasked}`, 0.951, 1);
  add('CONTRACT', 'plan', 'Plan contratado', product.plan, `PLAN: ${product.plan}`, 0.987, 1);
  add('CONTRACT', 'contributionAmount', 'Aporte acordado', product.contributionAmount, `Aporte ordinario: ${product.currency} ${product.contributionAmount}`, 0.944, 6);
  add('CONTRACT', 'signaturesComplete', 'Aceptación firmada', facts.signaturesComplete, `Firma del afiliado: ${facts.signaturesComplete ? 'presente' : 'pendiente'}`, facts.signaturesComplete ? 0.932 : 0.34, 16);

  add('FINANCIAL_EDUCATION', 'fullName', 'Nombre', client.fullName, `YO, ${client.fullName}`, 0.974);
  add('FINANCIAL_EDUCATION', 'idNumber', 'Identificación', client.idNumberMasked, `No. de Identidad: ${client.idNumberMasked}`, 0.969);
  add('FINANCIAL_EDUCATION', 'educationFinancialYear', 'Año', facts.educationFinancialYear ?? null, facts.educationFinancialYear ? `Fecha completa: 15/07/${facts.educationFinancialYear}` : 'Fecha: 15/07/____', facts.educationFinancialYear ? 0.956 : 0.14);
  add('FINANCIAL_EDUCATION', 'signaturesComplete', 'Firma', facts.signaturesComplete, `Firma: ${facts.signaturesComplete ? 'presente' : 'pendiente'}`, facts.signaturesComplete ? 0.91 : 0.31);

  add('SOURCE_OF_FUNDS', 'fullName', 'Titular del respaldo', client.fullName, `Titular: ${client.fullName}`, 0.943);
  add('SOURCE_OF_FUNDS', 'sourceOfFunds', 'Origen evidenciado', product.sourceOfFunds, `Actividad o ingreso: ${product.sourceOfFunds}`, facts.sourceOfFundsDocumented ? 0.936 : 0.52);
  add('SOURCE_OF_FUNDS', 'supportedAmount', 'Capacidad documentada', facts.sourceOfFundsDocumented ? product.contributionAmount : null, facts.sourceOfFundsDocumented ? `Capacidad compatible con aporte ${product.currency} ${product.contributionAmount}` : 'Capacidad: no demostrada', facts.sourceOfFundsDocumented ? 0.902 : 0.28);

  add('SCREENING', 'fullName', 'Nombre consultado', client.fullName, `Consulta sintética: ${client.fullName}`, 0.962);
  add('SCREENING', 'pepDeclared', 'Resultado PEP', facts.pepDeclared, `Coincidencia PEP: ${facts.pepDeclared ? 'Revisar' : 'No detectada'}`, 0.971);
  add('SCREENING', 'screeningResult', 'Listas y cautelas', facts.pepDeclared ? 'REVIEW' : 'CLEAR', `Resultado sintético: ${facts.pepDeclared ? 'requiere revisión' : 'sin coincidencias'}`, 0.954);

  add('EMAIL_CHECKLIST', 'reference', 'Referencia del caso', afpcCase.reference, `Asunto: Expediente ${afpcCase.reference}`, 0.984);
  add('EMAIL_CHECKLIST', 'attachmentCount', 'Adjuntos recibidos', afpcCase.documents.length, `Adjuntos sintéticos identificados: ${afpcCase.documents.length}`, 0.942);
  add('EMAIL_CHECKLIST', 'packageReceived', 'Paquete recibido', true, 'Lista de verificación de recepción: completa', 0.931);

  return fields;
}

function buildConsistency(extractedFields: ExtractedDocumentField[]): ConsistencyCheck[] {
  const compare = (field: string, label: string, expectedTypes: string[]): ConsistencyCheck => {
    const sources = extractedFields
      .filter((item) => item.field === field && expectedTypes.includes(item.documentType))
      .map(({ documentType, documentId, value, confidence }) => ({
        documentType,
        documentId,
        value,
        confidence,
      }));
    const present = sources.filter((source) => source.value !== null && source.value !== '');
    const uniqueValues = new Set(present.map((source) => normalizeComparable(source.value)));
    let verdict: ConsistencyCheck['verdict'];
    let explanation: string;
    if (sources.length === 0 || present.length !== sources.length) {
      verdict = 'MISSING';
      explanation = `${label}: al menos una fuente esperada no contiene un valor verificable.`;
    } else if (uniqueValues.size > 1) {
      verdict = 'MISMATCH';
      explanation = `${label}: los documentos presentan valores distintos y requieren conciliación humana.`;
    } else if (sources.length < 2) {
      verdict = 'REVIEW';
      explanation = `${label}: solo existe una fuente disponible; no es posible realizar cruce documental.`;
    } else {
      verdict = 'MATCH';
      explanation = `${label}: coincidencia exacta en ${sources.length} fuentes sintéticas.`;
    }
    return {
      field,
      label,
      verdict,
      confidence: present.length
        ? round(present.reduce((sum, source) => sum + source.confidence, 0) / present.length, 3)
        : 0,
      explanation,
      sources,
    };
  };

  return [
    compare('fullName', 'Nombre completo', ['AFFILIATION_FORM', 'IDENTITY', 'FATCA', 'CONTRACT', 'FINANCIAL_EDUCATION']),
    compare('idNumber', 'Número de identificación', ['AFFILIATION_FORM', 'IDENTITY', 'FATCA', 'CONTRACT', 'FINANCIAL_EDUCATION']),
    compare('nationality', 'Nacionalidad', ['AFFILIATION_FORM', 'IDENTITY']),
    compare('residenceCountry', 'País de residencia', ['AFFILIATION_FORM', 'FATCA']),
    compare('city', 'Ciudad o domicilio', ['AFFILIATION_FORM', 'IDENTITY', 'FATCA']),
    compare('plan', 'Plan solicitado', ['AFFILIATION_FORM', 'CONTRACT']),
    compare('contributionAmount', 'Monto de aporte', ['AFFILIATION_FORM', 'CONTRIBUTION_RECEIPT', 'CONTRACT']),
    compare('sourceOfFunds', 'Procedencia de fondos', ['AFFILIATION_FORM', 'CONTRIBUTION_RECEIPT', 'SOURCE_OF_FUNDS']),
    compare('educationFinancialYear', 'Año de educación financiera', ['AFFILIATION_FORM', 'FINANCIAL_EDUCATION']),
    compare('signaturesComplete', 'Firmas requeridas', ['CONTRACT', 'FINANCIAL_EDUCATION']),
  ];
}

function normalizeSourceOfFunds(source: string): SourceOfFundsInsight['normalizedCategory'] {
  const normalized = source.normalize('NFD').replaceAll(/[\u0300-\u036f]/gu, '').toLowerCase();
  if (normalized.includes('salari') || normalized.includes('remuner')) return 'SALARY';
  if (normalized.includes('servicio') || normalized.includes('profesional')) return 'PROFESSIONAL_SERVICES';
  if (normalized.includes('venta')) return 'ASSET_SALE';
  if (normalized.includes('ahorro')) return 'SAVINGS';
  if (normalized.includes('remesa')) return 'REMITTANCES';
  if (normalized.includes('prestacion')) return 'EMPLOYMENT_BENEFITS';
  return 'OTHER';
}

function sourceCategoryLabel(category: SourceOfFundsInsight['normalizedCategory']): string {
  const labels: Record<SourceOfFundsInsight['normalizedCategory'], string> = {
    SALARY: 'remuneración salarial',
    PROFESSIONAL_SERVICES: 'servicios profesionales',
    ASSET_SALE: 'venta de bienes',
    SAVINGS: 'ahorros acumulados',
    REMITTANCES: 'remesas',
    EMPLOYMENT_BENEFITS: 'prestaciones laborales',
    OTHER: 'otra procedencia',
  };
  return labels[category];
}

function sourceAlignmentLabel(alignment: SourceOfFundsInsight['alignment']): string {
  return {
    CONSISTENT: 'coherente',
    REVIEW: 'requiere revisión',
    INSUFFICIENT: 'insuficientemente respaldada',
  }[alignment];
}

function riskRouteLabel(route: AfpcCase['risk']['route']): string {
  return {
    REVISION_ESTANDAR: 'revisión estándar',
    REVISION_REFORZADA: 'revisión reforzada',
    CUMPLIMIENTO: 'Cumplimiento',
  }[route];
}

function analyzeSourceOfFunds(afpcCase: AfpcCase): SourceOfFundsInsight {
  const sourceEvidenceDocuments = afpcCase.documents
    .filter((document) => document.type === 'SOURCE_OF_FUNDS')
    .map((document) => document.id);
  const transactionDocuments = afpcCase.documents
    .filter((document) => document.type === 'CONTRIBUTION_RECEIPT')
    .map((document) => document.id);
  const evidenceDocuments = afpcCase.documents
    .filter((document) => ['SOURCE_OF_FUNDS', 'CONTRIBUTION_RECEIPT'].includes(document.type))
    .map((document) => document.id);
  const normalizedCategory = normalizeSourceOfFunds(afpcCase.product.sourceOfFunds);
  const hasEvidence = afpcCase.facts.sourceOfFundsDocumented && sourceEvidenceDocuments.length > 0;
  const genericSource = normalizedCategory === 'OTHER';
  const enhancedBand = afpcCase.product.contributionAmount > 2_000;
  const alignment: SourceOfFundsInsight['alignment'] = !hasEvidence
    ? 'INSUFFICIENT'
    : genericSource || enhancedBand
      ? 'REVIEW'
      : 'CONSISTENT';
  const checks: SourceOfFundsInsight['checks'] = [
    {
      code: 'SOF_DECLARED',
      label: 'Procedencia declarada',
      status: afpcCase.product.sourceOfFunds.trim() ? 'PASS' : 'FAIL',
      reason: afpcCase.product.sourceOfFunds.trim()
        ? `El formulario declara "${afpcCase.product.sourceOfFunds}".`
        : 'No existe una procedencia declarada.',
    },
    {
      code: 'SOF_DOCUMENTED',
      label: 'Respaldo documental',
      status: hasEvidence ? 'PASS' : 'FAIL',
      reason: hasEvidence
        ? `Se localizó respaldo específico de procedencia; ${quantity(transactionDocuments.length, 'comprobante solo corrobora', 'comprobantes solo corroboran')} el movimiento.`
        : transactionDocuments.length > 0
          ? 'Existe comprobante de aporte, pero por sí solo no demuestra la procedencia de los fondos.'
          : 'No se localizó evidencia suficiente para la fuente declarada.',
    },
    {
      code: 'SOF_PROFILE_ALIGNMENT',
      label: 'Coherencia con perfil económico',
      status: genericSource ? 'REVIEW' : 'PASS',
      reason: genericSource
        ? 'La categoría "otros" requiere una descripción y validación manual.'
        : `La fuente se clasificó como ${sourceCategoryLabel(normalizedCategory)}.`,
    },
    {
      code: 'SOF_AMOUNT_BAND',
      label: 'Banda de aporte',
      status: enhancedBand ? 'REVIEW' : 'PASS',
      reason: enhancedBand
        ? 'El monto supera el umbral ilustrativo de 2,000 y requiere revisión reforzada.'
        : 'El monto no supera el umbral reforzado configurado para la demostración.',
    },
  ];
  return {
    declaredSource: afpcCase.product.sourceOfFunds,
    normalizedCategory,
    amount: afpcCase.product.contributionAmount,
    currency: afpcCase.product.currency,
    alignment,
    confidence: hasEvidence ? (genericSource || enhancedBand ? 0.82 : 0.94) : 0.41,
    evidenceDocuments,
    checks,
    explanation:
      alignment === 'CONSISTENT'
        ? 'La fuente declarada, el comprobante y el respaldo sintético son coherentes para la banda del aporte.'
        : alignment === 'REVIEW'
          ? 'Existe evidencia, pero la categoría o el monto requiere criterio humano y revisión reforzada.'
          : 'La evidencia disponible no permite respaldar la procedencia declarada.',
    policyRef: 'F-AFPC-18-V2 · Matriz documental demo pendiente de aprobación',
  };
}

function detectAnomalies(
  afpcCase: AfpcCase,
  extractedFields: ExtractedDocumentField[],
  consistency: ConsistencyCheck[],
  sourceOfFunds: SourceOfFundsInsight,
): DocumentAnomaly[] {
  const anomalies: DocumentAnomaly[] = [];
  const fieldRefs = (code: string, documentType?: string) => {
    const matching = extractedFields.filter(
      (field) =>
        (documentType && field.documentType === documentType) ||
        (code === 'ADDRESS_MISMATCH' && field.field === 'city') ||
        (code === 'EDUCATION_YEAR_REQUIRED' && field.field === 'educationFinancialYear'),
    );
    return matching.slice(0, 5).map((field) => field.id);
  };
  const categoryFor = (code: string): DocumentAnomaly['category'] => {
    if (code.includes('FATCA') || code.includes('PEP')) return 'regulatory';
    if (code.includes('SOURCE_OF_FUNDS')) return 'source-of-funds';
    if (code.includes('ADDRESS') || code.includes('BENEFICIARY')) return 'consistency';
    if (code.includes('CONTRIBUTION')) return 'transaction-profile';
    return 'completeness';
  };

  for (const validation of afpcCase.validations.filter((item) => item.severity !== 'info')) {
    anomalies.push({
      id: `anomaly-${validation.code.toLowerCase().replaceAll('_', '-')}`,
      severity: validation.severity === 'error' || ['FATCA_POSITIVE', 'PEP_DECLARED'].includes(validation.code) ? 'high' : 'medium',
      category: categoryFor(validation.code),
      title: validation.title,
      explanation: validation.message,
      evidenceRefs: fieldRefs(validation.code, validation.documentType),
      suggestedAction:
        validation.severity === 'error'
          ? 'Solicitar corrección y revalidar el expediente antes de continuar.'
          : validation.code === 'FATCA_POSITIVE' || validation.code === 'PEP_DECLARED'
            ? 'Mantener el caso en Cumplimiento y documentar la decisión humana.'
            : 'Confirmar la diferencia contra la evidencia fuente.',
      ruleCode: validation.code,
    });
  }

  for (const check of consistency.filter((item) => item.verdict === 'MISMATCH')) {
    const id = `anomaly-consistency-${check.field}`;
    if (anomalies.some((item) => item.id === id || (check.field === 'city' && item.ruleCode === 'ADDRESS_MISMATCH'))) continue;
    anomalies.push({
      id,
      severity: 'medium',
      category: 'consistency',
      title: `${check.label} inconsistente`,
      explanation: check.explanation,
      evidenceRefs: extractedFields.filter((field) => field.field === check.field).map((field) => field.id),
      suggestedAction: 'Conciliar el dato con el cliente y conservar la evidencia de la corrección.',
      ruleCode: `CONSISTENCY_${check.field.toUpperCase()}`,
    });
  }

  if (sourceOfFunds.alignment === 'INSUFFICIENT' && !anomalies.some((item) => item.category === 'source-of-funds')) {
    anomalies.push({
      id: 'anomaly-source-of-funds-insufficient',
      severity: 'high',
      category: 'source-of-funds',
      title: 'Procedencia de fondos insuficientemente respaldada',
      explanation: sourceOfFunds.explanation,
      evidenceRefs: sourceOfFunds.evidenceDocuments,
      suggestedAction: 'Solicitar el respaldo definido para la categoría de procedencia declarada.',
      ruleCode: 'SOF_INSUFFICIENT',
    });
  }

  return anomalies;
}

function buildRecommendation(
  afpcCase: AfpcCase,
  anomalies: DocumentAnomaly[],
  consistency: ConsistencyCheck[],
  sourceOfFunds: SourceOfFundsInsight,
): CaseRecommendation {
  const hasBlockingError = afpcCase.validations.some((validation) => validation.severity === 'error');
  const needsCompliance = afpcCase.risk.route === 'CUMPLIMIENTO';
  const hasMismatch = consistency.some((check) => check.verdict === 'MISMATCH');
  const decision: CaseRecommendation['decision'] = hasBlockingError
    ? 'SUBSANATE'
    : needsCompliance
      ? 'ESCALATE_COMPLIANCE'
      : hasMismatch || sourceOfFunds.alignment !== 'CONSISTENT'
        ? 'HUMAN_REVIEW'
        : 'CONTINUE';
  const labels: Record<CaseRecommendation['decision'], string> = {
    SUBSANATE: 'Subsanar antes de continuar',
    ESCALATE_COMPLIANCE: 'Continuar análisis en Cumplimiento',
    HUMAN_REVIEW: 'Revisión humana reforzada',
    CONTINUE: 'Continuar a decisión humana',
  };
  const rationale = [
    `${quantity(afpcCase.documents.length, 'documento sintético clasificado', 'documentos sintéticos clasificados')} y ${quantity(afpcCase.validations.length, 'control activo', 'controles activos')}.`,
    `${quantity(anomalies.length, 'anomalía explicable', 'anomalías explicables')}; ${anomalies.filter((item) => item.severity === 'high').length} de prioridad alta.`,
    `Procedencia de fondos: ${sourceAlignmentLabel(sourceOfFunds.alignment)}.`,
    `Ruta de riesgo vigente: ${riskRouteLabel(afpcCase.risk.route)}.`,
  ];
  const nextSteps: CaseRecommendation['nextSteps'] = [];
  if (hasBlockingError) {
    nextSteps.push({
      order: nextSteps.length + 1,
      owner: 'Agencia / asesor',
      action: 'Completar los campos o documentos marcados como bloqueo.',
      reason: 'El motor determinístico impide continuar mientras existan errores.',
    });
  }
  if (hasMismatch) {
    nextSteps.push({
      order: nextSteps.length + 1,
      owner: 'Control de Calidad',
      action: 'Conciliar los valores divergentes contra su evidencia fuente.',
      reason: 'La matriz detectó diferencias entre documentos.',
    });
  }
  if (needsCompliance) {
    nextSteps.push({
      order: nextSteps.length + 1,
      owner: 'Cumplimiento',
      action: 'Revisar FATCA, perfil y procedencia con las evidencias señaladas.',
      reason: 'La ruta configurada exige una decisión reforzada.',
    });
  }
  if (sourceOfFunds.alignment !== 'CONSISTENT') {
    nextSteps.push({
      order: nextSteps.length + 1,
      owner: 'Analista de Afiliaciones',
      action: 'Confirmar que la evidencia respalde el monto y la categoría declarada.',
      reason: sourceOfFunds.explanation,
    });
  }
  nextSteps.push({
    order: nextSteps.length + 1,
    owner: 'Analista autorizado',
    action: 'Registrar la decisión humana y su justificación.',
    reason: 'La IA solo orienta; nunca aprueba ni rechaza el expediente.',
  });
  return {
    decision,
    label: labels[decision],
    confidence: hasBlockingError || needsCompliance ? 0.97 : 0.91,
    humanDecisionRequired: true,
    rationale,
    nextSteps,
  };
}

export function buildLocalDocumentIntelligence(
  afpcCase: AfpcCase,
  configured = false,
): DocumentIntelligenceInsight {
  const fingerprint = documentIntelligenceFingerprint(afpcCase);
  const documents = classifyDocuments(afpcCase.id, afpcCase.documents);
  const extractedFields = extractFields(afpcCase);
  const consistency = buildConsistency(extractedFields);
  const sourceOfFunds = analyzeSourceOfFunds(afpcCase);
  const anomalies = detectAnomalies(afpcCase, extractedFields, consistency, sourceOfFunds);
  const recommendation = buildRecommendation(afpcCase, anomalies, consistency, sourceOfFunds);
  const extracted = extractedFields.filter((field) => field.status !== 'MISSING');
  const averageConfidence = extracted.length
    ? round(extracted.reduce((sum, field) => sum + field.confidence, 0) / extracted.length, 3)
    : 0;
  const matchingChecks = consistency.filter((check) => check.verdict === 'MATCH').length;
  const consistencyRate = consistency.length ? round(matchingChecks / consistency.length, 3) : 0;
  const estimatedManualMinutes = documents.reduce((sum, document) => sum + 2 + document.pages * 0.8, 0);
  const estimatedAutomatedSeconds = round(1.1 + documents.length * 0.18 + extractedFields.length * 0.012, 1);

  const insight: DocumentIntelligenceInsight = {
    analysis: {
      id: `di-${afpcCase.id}-${fingerprint.slice(0, 12)}`,
      fingerprint,
      engineVersion: DOCUMENT_INTELLIGENCE_ENGINE_VERSION,
      generatedAt: afpcCase.updatedAt,
      provider: 'local-fallback',
      configured,
      cached: false,
      syntheticOnly: true,
      mode: 'document-pipeline-demo',
      dataOrigin: 'synthetic-canonical-snapshot',
      extractionMethod: 'template-mapped-canonical-data',
      notOcrNotice: 'La ubicación se verifica localmente contra la capa de texto del PDF o, cuando se trata de un escaneo, mediante reconocimiento óptico local. Los documentos nunca salen del equipo para localizar la evidencia.',
      confidenceNotice: 'La confianza mide calidad de extracción simulada; no equivale a cumplimiento, aprobación ni autenticidad documental.',
    },
    pipeline: [
      { id: 'ingestion', label: 'Ingesta segura', status: 'completed', durationMs: 140, itemsProcessed: documents.length },
      { id: 'classification', label: 'Clasificación documental', status: 'completed', durationMs: 260, itemsProcessed: documents.length },
      { id: 'extraction', label: 'Extracción estructurada', status: 'completed', durationMs: 610, itemsProcessed: extractedFields.length },
      { id: 'consistency', label: 'Cruce de consistencia', status: 'completed', durationMs: 230, itemsProcessed: consistency.length },
      { id: 'risk', label: 'Riesgo y recomendación', status: 'completed', durationMs: 190, itemsProcessed: anomalies.length },
    ],
    metrics: {
      documentsProcessed: documents.length,
      fieldsExtracted: extracted.length,
      averageConfidence,
      consistencyRate,
      anomaliesDetected: anomalies.length,
      estimatedManualMinutes: round(estimatedManualMinutes, 1),
      estimatedAutomatedSeconds,
      estimatedMinutesSaved: round(Math.max(0, estimatedManualMinutes - estimatedAutomatedSeconds / 60), 1),
    },
    executiveSummary: `${quantity(documents.length, 'documento sintético procesado', 'documentos sintéticos procesados')} con ${quantity(extracted.length, 'campo', 'campos')} y ${Math.round(averageConfidence * 100)}% de confianza media. ${recommendation.label}. ${anomalies.length === 1 ? 'Se detectó' : 'Se detectaron'} ${quantity(anomalies.length, 'anomalía', 'anomalías')}, ${anomalies.length === 1 ? 'enlazada' : 'enlazadas'} a evidencia y reglas explicables. La recomendación es orientativa y exige decisión humana.`,
    documents,
    extractedFields,
    consistency,
    anomalies,
    sourceOfFunds,
    recommendation,
    limitations: [
      'Los PDF con texto seleccionable se verifican directamente; los escaneos usan reconocimiento óptico local en equipos macOS compatibles.',
      'Solo se muestra un recuadro cuando el valor coincide con texto seleccionable del PDF cargado.',
      'El comprobante de aporte no demuestra por sí solo la procedencia de fondos.',
      'La confianza de extracción no equivale a cumplimiento ni sustituye la decisión humana.',
    ],
  };
  return insight;
}

interface GeminiEnrichment {
  executiveSummary?: unknown;
  rationale?: unknown;
  nextSteps?: unknown;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

const cleanText = (value: unknown, maximumLength: number) =>
  typeof value === 'string'
    ? value.replaceAll('**', '').replaceAll(/\s+/gu, ' ').trim().slice(0, maximumLength)
    : '';

const containsEnglishOperationalTerms = (values: string[]) =>
  /\b(?:workflow|pipeline|fallback|snapshot|checklist|screening|review|missing|match|mismatch|source|funds|compliance|approved|rejected|score|risk|high|medium|low|warning|customer|case|document|field|owner|ready|standard)\b/iu.test(values.join(' '));

function parseGeminiEnrichment(payload: GeminiResponse): GeminiEnrichment | undefined {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text.replace(/^```json\s*/u, '').replace(/\s*```$/u, '')) as GeminiEnrichment;
  } catch {
    return undefined;
  }
}

export async function analyzeDocumentIntelligence(
  afpcCase: AfpcCase,
  config: GeminiConfig,
): Promise<DocumentIntelligenceInsight> {
  const local = buildLocalDocumentIntelligence(afpcCase, config.configured);
  if (!config.apiKey) return local;

  // This snapshot intentionally excludes names, identification values, contact
  // data, evidence text and uploaded file contents.
  const safeSyntheticSnapshot = {
    notice: 'SYNTHETIC DEMO DATA ONLY',
    reference: afpcCase.reference,
    status: afpcCase.status,
    product: {
      planCategory: 'individual-pension-plan',
      currency: afpcCase.product.currency,
      contributionAmount: afpcCase.product.contributionAmount,
      sourceCategory: local.sourceOfFunds.normalizedCategory,
    },
    risk: afpcCase.risk,
    documentTypes: local.documents.map((document) => ({
      type: document.predictedType,
      confidence: document.confidence,
      completeness: document.quality.completeness,
    })),
    validationCodes: afpcCase.validations.map(({ code, severity }) => ({ code, severity })),
    consistency: local.consistency.map(({ field, verdict, confidence }) => ({
      field,
      verdict,
      confidence,
    })),
    anomalyCodes: local.anomalies.map(({ ruleCode, severity, category }) => ({
      ruleCode,
      severity,
      category,
    })),
    sourceOfFunds: {
      category: local.sourceOfFunds.normalizedCategory,
      alignment: local.sourceOfFunds.alignment,
      checks: local.sourceOfFunds.checks.map(({ code, status }) => ({ code, status })),
    },
    deterministicRecommendation: local.recommendation.decision,
  };
  const prompt = [
    'Actúa como asistente documental para una demostración sintética de afiliación AFPC.',
    'Devuelve JSON conforme al schema. Resume hallazgos, justifica la recomendación determinística y propone próximos pasos.',
    'Escribe todos los valores textuales exclusivamente en español profesional de Honduras. Traduce los códigos internos y no uses términos operativos en inglés.',
    'No apruebes, no rechaces y no cambies la ruta determinística. Indica que la decisión es humana.',
    JSON.stringify(safeSyntheticSnapshot),
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 2_048,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                executiveSummary: { type: 'STRING' },
                rationale: { type: 'ARRAY', items: { type: 'STRING' } },
                nextSteps: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      owner: { type: 'STRING' },
                      action: { type: 'STRING' },
                      reason: { type: 'STRING' },
                    },
                    required: ['owner', 'action', 'reason'],
                  },
                },
              },
              required: ['executiveSummary', 'rationale', 'nextSteps'],
            },
          },
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) return local;
    const enrichment = parseGeminiEnrichment((await response.json()) as GeminiResponse);
    if (!enrichment) return local;
    const executiveSummary = cleanText(enrichment.executiveSummary, 700);
    const rationale = Array.isArray(enrichment.rationale)
      ? enrichment.rationale.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 4)
      : [];
    const geminiSteps = Array.isArray(enrichment.nextSteps)
      ? enrichment.nextSteps
          .map((item) => {
            const candidate = item as Record<string, unknown>;
            return {
              owner: cleanText(candidate.owner, 80),
              action: cleanText(candidate.action, 180),
              reason: cleanText(candidate.reason, 220),
            };
          })
          .filter((item) => item.owner && item.action && item.reason)
          .slice(0, 3)
      : [];
    if (containsEnglishOperationalTerms([
      executiveSummary,
      ...rationale,
      ...geminiSteps.flatMap((step) => [step.owner, step.action, step.reason]),
    ])) return local;
    if (!executiveSummary || rationale.length === 0) return local;
    const nextSteps = geminiSteps.length
      ? geminiSteps.map((step, index) => ({ order: index + 1, ...step }))
      : local.recommendation.nextSteps;
    if (!nextSteps.some((step) => step.action.toLowerCase().includes('decisión humana'))) {
      nextSteps.push({
        order: nextSteps.length + 1,
        owner: 'Analista autorizado',
        action: 'Registrar la decisión humana y su justificación.',
        reason: 'La salida de IA es únicamente orientativa.',
      });
    }
    return {
      ...local,
      analysis: {
        ...local.analysis,
        generatedAt: new Date().toISOString(),
        provider: 'gemini',
        configured: true,
      },
      executiveSummary,
      recommendation: {
        ...local.recommendation,
        rationale: [...local.recommendation.rationale, ...rationale].slice(0, 7),
        nextSteps,
      },
    };
  } catch {
    return local;
  }
}

export function asCachedInsight(insight: DocumentIntelligenceInsight): DocumentIntelligenceInsight {
  const clone = structuredClone(insight);
  clone.analysis.cached = true;
  return clone;
}
