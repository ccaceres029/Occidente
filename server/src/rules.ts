import { STATUS_PROGRESS } from './labels.js';
import type {
  AfpcCase,
  CaseDocument,
  RiskAssessment,
  RuleEvaluation,
  ValidationResult,
  WorkflowAction,
} from './types.js';

export const REQUIRED_DOCUMENTS = [
  { type: 'AFFILIATION_FORM', label: 'Formulario de afiliación' },
  { type: 'IDENTITY', label: 'Documento de identidad' },
  { type: 'RTN', label: 'Registro Tributario Nacional' },
  { type: 'CONTRIBUTION_RECEIPT', label: 'Comprobante de aporte' },
  { type: 'FINANCIAL_EDUCATION', label: 'Constancia de educación financiera' },
  { type: 'FATCA', label: 'Autocertificación FATCA' },
  { type: 'CONTRACT', label: 'Contrato de afiliación' },
] as const;

const activeDocument = (documents: CaseDocument[], type: string) =>
  documents.find((document) => document.type === type && document.status !== 'MISSING');

const validation = (
  code: string,
  severity: ValidationResult['severity'],
  title: string,
  message: string,
  extra: Partial<ValidationResult> = {},
): ValidationResult => ({
  id: `rule-${code.toLowerCase().replaceAll('_', '-')}`,
  code,
  severity,
  title,
  message,
  resolved: false,
  ...extra,
});

export function evaluateCaseRules(afpcCase: AfpcCase): RuleEvaluation {
  const validations: ValidationResult[] = [];
  const reasons: string[] = [];
  let score = 5;
  let forcedCompliance = false;

  for (const requirement of REQUIRED_DOCUMENTS) {
    if (!activeDocument(afpcCase.documents, requirement.type)) {
      validations.push(
        validation(
          `MISSING_${requirement.type}`,
          'error',
          `${requirement.label} pendiente`,
          `Debe incorporarse ${requirement.label.toLowerCase()} antes de aprobar el expediente.`,
          { documentType: requirement.type, policyRef: 'Matriz documental demo v0.1' },
        ),
      );
      score += 10;
    }
  }

  if (!afpcCase.facts.educationFinancialYear) {
    validations.push(
      validation(
        'EDUCATION_YEAR_REQUIRED',
        'error',
        'Año de la constancia pendiente',
        'La constancia de educación financiera tiene día y mes, pero no contiene el año.',
        {
          field: 'facts.educationFinancialYear',
          documentType: 'FINANCIAL_EDUCATION',
          policyRef: 'Control de completitud documental',
        },
      ),
    );
    score += 15;
  }

  if (!afpcCase.facts.identityVerified) {
    validations.push(
      validation(
        'IDENTITY_NOT_VERIFIED',
        'error',
        'Identidad no verificada',
        'La identidad debe verificarse contra el documento presentado.',
        { field: 'facts.identityVerified', policyRef: 'Debida diligencia del cliente' },
      ),
    );
    score += 35;
  }

  if (!afpcCase.facts.sourceOfFundsDocumented) {
    validations.push(
      validation(
        'SOURCE_OF_FUNDS_UNSUPPORTED',
        'error',
        'Procedencia sin respaldo suficiente',
        'La procedencia declarada no cuenta con la evidencia documental configurada.',
        {
          field: 'product.sourceOfFunds',
          documentType: 'SOURCE_OF_FUNDS',
          policyRef: 'F-AFPC-18-V2',
        },
      ),
    );
    reasons.push('Procedencia de fondos sin respaldo');
    score += 35;
  }

  if (!afpcCase.facts.addressConsistent) {
    validations.push(
      validation(
        'ADDRESS_MISMATCH',
        'warning',
        'Domicilio requiere confirmación',
        'La ciudad o residencia declarada difiere entre los datos capturados y los documentos.',
        { field: 'client.city', policyRef: 'Consistencia del expediente' },
      ),
    );
    reasons.push('Diferencia de domicilio');
    score += 20;
  }

  if (afpcCase.facts.beneficiaryPercentTotal !== 100) {
    validations.push(
      validation(
        'BENEFICIARY_PERCENT_TOTAL',
        'error',
        'Porcentaje de beneficiarios inválido',
        `La distribución actual suma ${afpcCase.facts.beneficiaryPercentTotal}%; debe sumar exactamente 100%.`,
        { field: 'facts.beneficiaryPercentTotal', policyRef: 'F-AFPC-16-V2' },
      ),
    );
    score += 15;
  }

  if (!afpcCase.facts.signaturesComplete) {
    validations.push(
      validation(
        'SIGNATURES_PENDING',
        'warning',
        'Firmas pendientes de confirmación',
        'Confirme que las firmas exigibles para esta etapa estén completas antes del registro en el sistema central.',
        { policyRef: 'Contrato y constancias del expediente' },
      ),
    );
    score += 10;
  }

  if (afpcCase.facts.fatcaPositive) {
    validations.push(
      validation(
        'FATCA_POSITIVE',
        'warning',
        'Indicador FATCA positivo',
        'El expediente declara al menos una condición FATCA y requiere revisión de Cumplimiento.',
        { documentType: 'FATCA', policyRef: 'Autocertificación FATCA' },
      ),
    );
    reasons.push('Indicador FATCA positivo');
    score += 45;
    forcedCompliance = true;
  }

  if (afpcCase.facts.pepDeclared) {
    validations.push(
      validation(
        'PEP_DECLARED',
        'warning',
        'Condición PEP declarada',
        'La declaración PEP requiere debida diligencia reforzada y decisión humana.',
        { policyRef: 'Debida diligencia reforzada' },
      ),
    );
    reasons.push('Condición PEP declarada');
    score += 50;
    forcedCompliance = true;
  }

  if (afpcCase.facts.apnfdDeclared) {
    validations.push(
      validation(
        'APNFD_DECLARED',
        'info',
        'Actividad APNFD declarada',
        'Validar la actividad económica y los respaldos aplicables.',
        { policyRef: 'Perfil económico del cliente' },
      ),
    );
    reasons.push('Actividad APNFD');
    score += 15;
  }

  if (afpcCase.product.contributionAmount > 2_000) {
    validations.push(
      validation(
        'CONTRIBUTION_ENHANCED_REVIEW',
        'info',
        'Aporte en banda reforzada del demo',
        'El monto supera 2,000 en la moneda indicada y se enruta a Cumplimiento según la regla demo configurable.',
        { field: 'product.contributionAmount', policyRef: 'Umbral demo pendiente de validación' },
      ),
    );
    reasons.push('Aporte superior al umbral demo');
    score += 25;
    forcedCompliance = true;
  } else if (afpcCase.product.contributionAmount > 1_000) {
    validations.push(
      validation(
        'CONTRIBUTION_REINFORCED_REVIEW',
        'info',
        'Aporte en banda de revisión reforzada',
        'El monto requiere revisión reforzada según la parametrización ilustrativa del demo.',
        { field: 'product.contributionAmount', policyRef: 'Umbral demo pendiente de validación' },
      ),
    );
    reasons.push('Aporte en banda reforzada');
    score += 15;
  }

  score = Math.min(score, 100);
  const risk: RiskAssessment = {
    level: score >= 60 ? 'ALTO' : score >= 30 ? 'MEDIO' : 'BAJO',
    score,
    route: forcedCompliance
      ? 'CUMPLIMIENTO'
      : score >= 30
        ? 'REVISION_REFORZADA'
        : 'REVISION_ESTANDAR',
    reasons: reasons.length > 0 ? reasons : ['Sin alertas de riesgo material en las reglas demo'],
  };

  const errors = validations.filter((item) => item.severity === 'error').length;
  const warnings = validations.filter((item) => item.severity === 'warning').length;
  const infos = validations.filter((item) => item.severity === 'info').length;
  const completedRules = Math.max(REQUIRED_DOCUMENTS.length + 5 - errors, 0);
  const completeness = Math.round((completedRules / (REQUIRED_DOCUMENTS.length + 5)) * 100);

  return {
    validations,
    risk,
    progress: Math.max(STATUS_PROGRESS[afpcCase.status], Math.min(completeness, 75)),
    summary: {
      errors,
      warnings,
      infos,
      canApprove: errors === 0,
      route: risk.route,
    },
  };
}

export function allowedActions(afpcCase: AfpcCase): WorkflowAction[] {
  switch (afpcCase.status) {
    case 'RECIBIDO':
    case 'EN_REVISION':
      return afpcCase.validations.some((item) => item.severity === 'error') ||
        afpcCase.risk.route === 'CUMPLIMIENTO'
        ? ['return', 'escalate']
        : ['return', 'escalate', 'approve'];
    case 'DEVUELTO':
      return ['correct'];
    case 'CORREGIDO':
      return afpcCase.validations.some((item) => item.severity === 'error') ||
        afpcCase.risk.route === 'CUMPLIMIENTO'
        ? ['return', 'escalate']
        : ['return', 'escalate', 'approve'];
    case 'ESCALADO_CUMPLIMIENTO':
      return afpcCase.validations.some((item) => item.severity === 'error')
        ? ['return']
        : ['return', 'approve'];
    case 'APROBADO':
      return ['ready-core'];
    case 'LISTO_CORE':
      return ['archive'];
    case 'ARCHIVADO':
      return [];
  }
}
