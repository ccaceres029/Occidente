import type {
  AiConsistencyCheck,
  CaseDetail,
  DocumentAiInsights,
} from './types';
import {
  documentTypeLabel,
  formatCurrency,
  formatEvidenceValue,
  ruleCodeLabel,
  spanishDynamicText,
  stateLabel,
} from './utils';

const safeDocument = (caseData: CaseDetail, matcher: string) =>
  caseData.documents.find((document) =>
    `${document.type} ${document.name}`.toLowerCase().includes(matcher.toLowerCase()),
  ) || caseData.documents[0];

const safeDocId = (caseData: CaseDetail, matcher: string) =>
  safeDocument(caseData, matcher)?.id || `synthetic-${matcher}`;

export function buildFallbackInsights(caseData: CaseDetail): DocumentAiInsights {
  const now = new Date().toISOString();
  const identityId = safeDocId(caseData, 'identity');
  const contractId = safeDocId(caseData, 'contract');
  const contributionId = safeDocId(caseData, 'contribution');
  const educationId = safeDocId(caseData, 'education');
  const unresolved = caseData.validations.filter((rule) => !rule.resolved);
  const needsReview = unresolved.length > 0 || caseData.risk.level.toLowerCase().includes('alt');

  return {
    analysis: {
      id: `local-${caseData.id}`,
      fingerprint: `demo-${caseData.id}-${caseData.documents.length}`,
      engineVersion: 'local-explainable-1.0',
      generatedAt: now,
      provider: 'local-fallback',
      cached: false,
      syntheticOnly: true,
    },
    pipeline: [
      { id: 'classify', label: 'Clasificar documentos', status: 'completed', durationMs: 180, itemsProcessed: caseData.documents.length },
      { id: 'extract', label: 'Extraer campos', status: 'completed', durationMs: 260, itemsProcessed: 5 },
      { id: 'contrast', label: 'Contrastar fuentes', status: 'completed', durationMs: 210, itemsProcessed: 4 },
      { id: 'risk', label: 'Evaluar señales de riesgo', status: 'completed', durationMs: 145, itemsProcessed: caseData.validations.length },
    ],
    metrics: {
      documentsProcessed: caseData.documents.length,
      fieldsExtracted: 5,
      averageConfidence: needsReview ? .81 : .95,
      consistencyRate: needsReview ? .75 : 1,
      anomaliesDetected: unresolved.length,
      estimatedManualMinutes: Math.round(caseData.documents.length * 3.5 + 5 * .5),
      estimatedAutomatedSeconds: .795,
      estimatedMinutesSaved: Math.max(0, Math.round(caseData.documents.length * 3.5 + 5 * .5 - .795 / 60)),
    },
    executiveSummary: needsReview
      ? 'El expediente sintético fue clasificado y contrastado. Se identificaron señales que requieren revisión humana antes de continuar; cada hallazgo conserva documento, página y evidencia.'
      : 'El expediente sintético presenta consistencia documental alta. Los datos principales coinciden entre las fuentes revisadas, sujeto a confirmación final por un analista autorizado.',
    documents: caseData.documents.map((document, index) => ({
      documentId: document.id,
      name: document.name,
      predictedType: document.type,
      label: document.type.replaceAll('_', ' '),
      confidence: document.confidence ?? Math.max(.82, .97 - index * .018),
      method: 'Clasificación semántica local',
      pages: document.pages || 1,
      quality: { readability: .94, completeness: document.status.toLowerCase().includes('warning') ? .78 : .96, orientation: 'correcta' },
    })),
    extractedFields: [
      {
        id: 'field-client-name', documentId: identityId, documentType: 'IDENTITY', field: 'client.fullName', label: 'Nombre completo', value: caseData.client.fullName, confidence: .98, page: 1,
        evidence: 'Nombre localizado en el bloque principal de identificación del documento sintético.', evidenceLocation: 'unavailable', status: 'CONFIRMED',
      },
      {
        id: 'field-id', documentId: identityId, documentType: 'IDENTITY', field: 'client.idNumber', label: 'Identificación', value: caseData.client.idNumberMasked, confidence: .99, page: 1,
        evidence: 'Identificador enmascarado contrastado con el formulario de afiliación.', evidenceLocation: 'unavailable', status: 'CONFIRMED',
      },
      {
        id: 'field-contribution', documentId: contributionId, documentType: 'CONTRIBUTION_RECEIPT', field: 'product.contributionAmount', label: 'Monto de aporte', value: `${caseData.product.currency} ${caseData.product.contributionAmount.toLocaleString('es-HN', { minimumFractionDigits: 2 })}`, confidence: .96, page: 1,
        evidence: 'Monto detectado en la sección de resumen de aporte del comprobante sintético.', evidenceLocation: 'unavailable', status: 'CONFIRMED',
      },
      {
        id: 'field-source', documentId: contractId, documentType: 'CONTRACT', field: 'product.sourceOfFunds', label: 'Procedencia de fondos', value: caseData.product.sourceOfFunds, confidence: needsReview ? .78 : .93, page: 2,
        evidence: 'Procedencia declarada localizada y normalizada para contrastarla con el perfil del aporte.', evidenceLocation: 'unavailable', status: needsReview ? 'REVIEW' : 'CONFIRMED',
      },
      {
        id: 'field-education-year', documentId: educationId, documentType: 'FINANCIAL_EDUCATION', field: 'education.year', label: 'Año de educación financiera', value: unresolved.some((rule) => rule.code.includes('EDUCATION')) ? 'No identificado' : String(new Date().getFullYear()), confidence: unresolved.some((rule) => rule.code.includes('EDUCATION')) ? .36 : .91, page: 1,
        evidence: unresolved.some((rule) => rule.code.includes('EDUCATION')) ? 'La zona esperada no contiene un año legible.' : 'Año localizado junto a la fecha de firma sintética.', evidenceLocation: 'unavailable', status: unresolved.some((rule) => rule.code.includes('EDUCATION')) ? 'REVIEW' : 'CONFIRMED',
      },
    ],
    consistency: [
      {
        field: 'client.fullName', label: 'Nombre del cliente', verdict: 'MATCH', confidence: .98, explanation: 'El nombre coincide entre identificación y contrato sintéticos.',
        sources: [{ documentType: 'IDENTITY', documentId: identityId, value: caseData.client.fullName, confidence: .98 }, { documentType: 'CONTRACT', documentId: contractId, value: caseData.client.fullName, confidence: .95 }],
      },
      {
        field: 'client.idNumber', label: 'Número de identificación', verdict: 'MATCH', confidence: .99, explanation: 'El identificador enmascarado conserva la misma terminación en las fuentes.',
        sources: [{ documentType: 'IDENTITY', documentId: identityId, value: caseData.client.idNumberMasked, confidence: .99 }, { documentType: 'CONTRACT', documentId: contractId, value: caseData.client.idNumberMasked, confidence: .96 }],
      },
      {
        field: 'product.contributionAmount', label: 'Monto del aporte', verdict: 'MATCH', confidence: .96, explanation: 'El aporte propuesto coincide con el comprobante sintético.',
        sources: [{ documentType: 'FORM', documentId: 'canonical-form', value: String(caseData.product.contributionAmount), confidence: 1 }, { documentType: 'CONTRIBUTION_RECEIPT', documentId: contributionId, value: String(caseData.product.contributionAmount), confidence: .96 }],
      },
      {
        field: 'product.sourceOfFunds', label: 'Procedencia de fondos', verdict: needsReview ? 'REVIEW' : 'MATCH', confidence: needsReview ? .74 : .92, explanation: needsReview ? 'La procedencia declarada necesita evidencia adicional o confirmación del analista.' : 'La procedencia declarada es coherente con el perfil sintético del aporte.',
        sources: [{ documentType: 'FORM', documentId: 'canonical-form', value: caseData.product.sourceOfFunds, confidence: 1 }, { documentType: 'CONTRACT', documentId: contractId, value: caseData.product.sourceOfFunds, confidence: needsReview ? .74 : .92 }],
      },
    ],
    anomalies: unresolved.map((rule) => ({
      id: `anomaly-${rule.id}`,
      severity: rule.severity.toLowerCase() === 'error' ? 'high' : 'medium',
      category: rule.documentType || 'DOCUMENT_COMPLETENESS',
      title: rule.title,
      explanation: rule.message,
      evidenceRefs: [rule.documentType || 'Expediente sintético', rule.field || 'Campo asociado'],
      suggestedAction: 'Revisar la evidencia señalada y documentar la decisión humana.',
      ruleCode: rule.code,
    })),
    sourceOfFunds: {
      declaredSource: caseData.product.sourceOfFunds,
      normalizedCategory: caseData.product.sourceOfFunds.toUpperCase().replaceAll(' ', '_'),
      amount: caseData.product.contributionAmount,
      currency: caseData.product.currency,
      alignment: needsReview ? 'REVIEW' : 'ALIGNED',
      confidence: needsReview ? .76 : .93,
      evidenceDocuments: [contractId, contributionId],
      checks: [
        { code: 'SOURCE_DECLARED', label: 'Procedencia declarada', status: 'PASS', reason: 'El formulario contiene una procedencia identificable.' },
        { code: 'AMOUNT_PROFILE', label: 'Monto versus perfil', status: needsReview ? 'REVIEW' : 'PASS', reason: needsReview ? 'Requiere confirmación de soporte.' : 'El monto es coherente con el escenario sintético.' },
        { code: 'EVIDENCE_LINKED', label: 'Evidencia vinculada', status: 'PASS', reason: 'Se localizaron documentos sintéticos relacionados.' },
      ],
      explanation: needsReview ? 'La IA detecta alineación parcial; el expediente debe ser contrastado por un analista.' : 'La procedencia, el monto y los soportes sintéticos muestran alineación suficiente para revisión estándar.',
      policyRef: 'Matriz documental y debida diligencia · Demo',
    },
    recommendation: {
      decision: needsReview ? 'HUMAN_REVIEW' : 'CONTINUE_STANDARD_REVIEW',
      label: needsReview ? 'Revisión humana requerida' : 'Continuar revisión estándar',
      confidence: needsReview ? .82 : .91,
      humanDecisionRequired: true,
      rationale: needsReview ? ['Existen hallazgos documentales abiertos.', 'La evidencia debe confirmarse antes de cualquier aprobación.'] : ['Los campos críticos muestran consistencia alta.', 'No se identificaron bloqueos automáticos en el análisis local.'],
      nextSteps: [
        { order: 1, owner: 'Afiliaciones', action: 'Revisar evidencia destacada', reason: 'Confirmar extracción y contexto documental.' },
        { order: 2, owner: needsReview ? 'Control de Calidad' : 'Afiliaciones', action: needsReview ? 'Resolver hallazgos' : 'Confirmar datos canónicos', reason: 'La IA únicamente recomienda; no decide.' },
      ],
    },
  };
}

export function getConsistencyStats(checks: AiConsistencyCheck[]) {
  const total = checks.length;
  const matched = checks.filter((check) => check.verdict.toUpperCase() === 'MATCH').length;
  const review = checks.filter((check) => ['REVIEW', 'MISMATCH', 'MISSING'].includes(check.verdict.toUpperCase())).length;
  return { total, matched, review, score: total ? Math.round((matched / total) * 100) : 0 };
}

export const toConfidencePercent = (value: number) => Math.round(Math.max(0, Math.min(1, value || 0)) * 100);

export function buildSpanishInsightsExport(insights: DocumentAiInsights) {
  const severityLabel = (severity: string) => ({ high: 'Alta', medium: 'Media', low: 'Baja' })[severity.toLowerCase()] || 'Sin clasificar';
  const percent = (value: number) => `${toConfidencePercent(value)}%`;

  return {
    análisis: {
      generadoEl: insights.analysis.generatedAt,
      motor: insights.analysis.provider === 'gemini' ? 'Gemini' : 'Motor local',
      configurado: insights.analysis.configured ? 'Sí' : 'No',
      resultadoAlmacenado: insights.analysis.cached ? 'Sí' : 'No',
      origenDeDatos: 'Expediente canónico sintético',
      métodoDeExtracción: 'Mapeo de campos para demostración',
    },
    resumenEjecutivo: spanishDynamicText(insights.executiveSummary),
    métricas: {
      documentosProcesados: insights.metrics.documentsProcessed,
      camposExtraídos: insights.metrics.fieldsExtracted,
      confianzaPromedio: percent(insights.metrics.averageConfidence),
      consistencia: percent(insights.metrics.consistencyRate),
      anomalíasDetectadas: insights.metrics.anomaliesDetected,
      minutosManualesEstimados: insights.metrics.estimatedManualMinutes,
      segundosAutomatizadosEstimados: insights.metrics.estimatedAutomatedSeconds,
      minutosAhorradosEstimados: insights.metrics.estimatedMinutesSaved,
    },
    flujoDeAnálisis: insights.pipeline.map((step) => ({
      etapa: spanishDynamicText(step.label),
      estado: stateLabel(step.status),
      duraciónEnMilisegundos: step.durationMs,
      elementosProcesados: step.itemsProcessed,
    })),
    documentos: insights.documents.map((document) => ({
      nombre: spanishDynamicText(document.name),
      tipo: documentTypeLabel(document.predictedType),
      confianza: percent(document.confidence),
      páginas: document.pages,
      calidad: {
        legibilidad: percent(document.quality.readability),
        integridad: percent(document.quality.completeness),
        orientación: spanishDynamicText(document.quality.orientation),
      },
    })),
    camposExtraídos: insights.extractedFields.map((field) => ({
      campo: spanishDynamicText(field.label),
      valor: formatEvidenceValue(field.value),
      documento: documentTypeLabel(field.documentType),
      página: field.page,
      evidencia: spanishDynamicText(field.evidence),
      confianza: percent(field.confidence),
      estado: stateLabel(field.status),
      ubicaciónDeEvidencia: field.evidenceLocation === 'verified-pdf-text' && field.boundingBox
        ? {
            estado: 'Verificada en el PDF',
            coordenadaHorizontal: field.boundingBox.x,
            coordenadaVertical: field.boundingBox.y,
            ancho: field.boundingBox.width,
            alto: field.boundingBox.height,
          }
        : { estado: 'No disponible' },
    })),
    consistencia: insights.consistency.map((check) => ({
      campo: spanishDynamicText(check.label),
      resultado: stateLabel(check.verdict),
      confianza: percent(check.confidence),
      explicación: spanishDynamicText(check.explanation),
      fuentes: check.sources.map((source) => ({
        documento: documentTypeLabel(source.documentType),
        valor: formatEvidenceValue(source.value),
        confianza: percent(source.confidence),
      })),
    })),
    alertas: insights.anomalies.map((anomaly) => ({
      severidad: severityLabel(anomaly.severity),
      título: spanishDynamicText(anomaly.title),
      explicación: spanishDynamicText(anomaly.explanation),
      referenciasDeEvidencia: anomaly.evidenceRefs.length,
      acciónSugerida: spanishDynamicText(anomaly.suggestedAction),
      regla: ruleCodeLabel(anomaly.ruleCode),
    })),
    procedenciaDeFondos: {
      procedenciaDeclarada: spanishDynamicText(insights.sourceOfFunds.declaredSource),
      categoríaNormalizada: spanishDynamicText(insights.sourceOfFunds.normalizedCategory),
      monto: formatCurrency(insights.sourceOfFunds.amount, insights.sourceOfFunds.currency),
      alineación: stateLabel(insights.sourceOfFunds.alignment),
      confianza: percent(insights.sourceOfFunds.confidence),
      comprobaciones: insights.sourceOfFunds.checks.map((check) => ({
        comprobación: spanishDynamicText(check.label),
        estado: stateLabel(check.status),
        motivo: spanishDynamicText(check.reason),
      })),
      explicación: spanishDynamicText(insights.sourceOfFunds.explanation),
      referenciaDePolítica: spanishDynamicText(insights.sourceOfFunds.policyRef),
    },
    recomendación: {
      decisión: spanishDynamicText(insights.recommendation.decision),
      etiqueta: spanishDynamicText(insights.recommendation.label),
      confianza: percent(insights.recommendation.confidence),
      decisiónHumanaObligatoria: insights.recommendation.humanDecisionRequired ? 'Sí' : 'No',
      fundamentos: insights.recommendation.rationale.map(spanishDynamicText),
      próximosPasos: insights.recommendation.nextSteps.map((step) => ({
        orden: step.order,
        responsable: spanishDynamicText(step.owner),
        acción: spanishDynamicText(step.action),
        motivo: spanishDynamicText(step.reason),
      })),
    },
  };
}
