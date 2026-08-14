import { STAGE_LABELS, STATUS_LABELS, STATUS_PROGRESS } from './labels.js';
import { evaluateCaseRules } from './rules.js';
import type { AfpcCase, AuditEvent, DemoDatabase } from './types.js';

const nowMinusHours = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const nowPlusHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

const baseDocuments = (caseId: string, educationWarning = false) => {
  const receivedAt = nowMinusHours(caseId === 'case-001' ? 7 : 26);
  const definitions = [
    { type: 'AFFILIATION_FORM', name: 'Formulario de afiliación sintético.pdf', status: 'VALID', pages: 2, fields: 34 },
    { type: 'IDENTITY', name: 'Identidad sintética.pdf', status: 'VALID', pages: 1, fields: 7 },
    { type: 'RTN', name: 'RTN sintético.pdf', status: 'VALID', pages: 1, fields: 4 },
    { type: 'CONTRIBUTION_RECEIPT', name: 'Comprobante de aporte sintético.pdf', status: 'VALID', pages: 1, fields: 6 },
    {
      type: 'FINANCIAL_EDUCATION',
      name: 'Constancia de educación financiera sintética.pdf',
      status: educationWarning ? 'WARNING' : 'VALID',
      pages: 1,
      fields: educationWarning ? 4 : 5,
    },
    { type: 'FATCA', name: 'Autocertificación FATCA sintética.pdf', status: 'VALID', pages: 1, fields: 12 },
    { type: 'CONTRACT', name: 'Contrato de afiliación sintético.pdf', status: 'VALID', pages: 8, fields: 9 },
    {
      type: 'SOURCE_OF_FUNDS',
      name:
        caseId === 'case-001'
          ? 'Constancia laboral sintética.pdf'
          : 'Contratos de servicios sintéticos.pdf',
      status: 'VALID',
      pages: caseId === 'case-001' ? 1 : 2,
      fields: caseId === 'case-001' ? 6 : 8,
    },
    { type: 'SCREENING', name: 'Resultado de listas sintético.pdf', status: 'VALID', pages: 1, fields: 4 },
    { type: 'EMAIL_CHECKLIST', name: 'Correo y lista de verificación sintética.pdf', status: 'VALID', pages: 1, fields: 3 },
  ];
  return definitions.map(({ type, name, status, pages, fields }, index) => ({
    id: `${caseId}-doc-${index + 1}`,
    name,
    type,
    status: status as 'VALID' | 'WARNING',
    synthetic: true as const,
    uploadedAt: receivedAt,
    mimeType: 'application/pdf',
    pages,
    confidence: status === 'WARNING' ? 0.82 : 0.96 + (index % 3) * 0.01,
    fieldsExtracted: fields,
  }));
};

function finalize(seed: Omit<AfpcCase, 'validations' | 'risk' | 'progress'>): AfpcCase {
  const provisional: AfpcCase = {
    ...seed,
    validations: [],
    risk: { level: 'BAJO', score: 0, route: 'REVISION_ESTANDAR', reasons: [] },
    progress: STATUS_PROGRESS[seed.status],
  };
  const evaluation = evaluateCaseRules(provisional);
  return {
    ...provisional,
    validations: evaluation.validations,
    risk: evaluation.risk,
    progress: evaluation.progress,
  };
}

export function createSeedDatabase(): DemoDatabase {
  const firstCreatedAt = nowMinusHours(7);
  const secondCreatedAt = nowMinusHours(26);

  const cases: AfpcCase[] = [
    finalize({
      id: 'case-001',
      reference: 'AFP-DEMO-2026-001',
      synthetic: true,
      status: 'EN_REVISION',
      statusLabel: STATUS_LABELS.EN_REVISION,
      currentStage: STAGE_LABELS.EN_REVISION,
      agency: 'Agencia Centro (demo)',
      advisor: 'Asesor Demo 01',
      assignee: 'Cinthia Murillo (rol demo)',
      createdAt: firstCreatedAt,
      updatedAt: firstCreatedAt,
      client: {
        fullName: 'María Cliente Demo',
        idType: 'DNI',
        idNumberMasked: '0801-****-0001',
        birthDate: '1988-04-12',
        nationality: 'Hondureña',
        residenceCountry: 'Honduras',
        city: 'Tegucigalpa',
        emailMasked: 'm***@demo.invalid',
        phoneMasked: '+504 ****-1001',
      },
      product: {
        plan: 'Plan Individual de Pensiones',
        currency: 'HNL',
        contributionAmount: 850,
        frequency: 'Mensual',
        paymentMethod: 'Débito a cuenta',
        sourceOfFunds: 'Salario',
      },
      facts: {
        educationFinancialYear: undefined,
        fatcaPositive: false,
        addressConsistent: true,
        sourceOfFundsDocumented: true,
        signaturesComplete: true,
        beneficiaryPercentTotal: 100,
        identityVerified: true,
        pepDeclared: false,
        apnfdDeclared: false,
      },
      sla: {
        receivedAt: firstCreatedAt,
        dueAt: nowPlusHours(17),
        ageHours: 7,
        breached: false,
      },
      documents: baseDocuments('case-001', true),
    }),
    finalize({
      id: 'case-002',
      reference: 'AFP-DEMO-2026-002',
      synthetic: true,
      status: 'ESCALADO_CUMPLIMIENTO',
      statusLabel: STATUS_LABELS.ESCALADO_CUMPLIMIENTO,
      currentStage: STAGE_LABELS.ESCALADO_CUMPLIMIENTO,
      agency: 'Agencia San Pedro Sula (demo)',
      advisor: 'Asesor Demo 02',
      assignee: 'Analista Cumplimiento Demo',
      createdAt: secondCreatedAt,
      updatedAt: nowMinusHours(2),
      client: {
        fullName: 'Carlos Cliente Ejemplo',
        idType: 'DNI',
        idNumberMasked: '0501-****-0002',
        birthDate: '1979-10-03',
        nationality: 'Hondureña',
        residenceCountry: 'Honduras',
        city: 'San Pedro Sula',
        emailMasked: 'c***@demo.invalid',
        phoneMasked: '+504 ****-2002',
      },
      product: {
        plan: 'Plan Individual de Pensiones',
        currency: 'HNL',
        contributionAmount: 750,
        frequency: 'Mensual',
        paymentMethod: 'Tarjeta de débito',
        sourceOfFunds: 'Servicios profesionales',
      },
      facts: {
        educationFinancialYear: 2026,
        fatcaPositive: true,
        addressConsistent: false,
        sourceOfFundsDocumented: true,
        signaturesComplete: true,
        beneficiaryPercentTotal: 100,
        identityVerified: true,
        pepDeclared: false,
        apnfdDeclared: false,
      },
      sla: {
        receivedAt: secondCreatedAt,
        dueAt: nowMinusHours(2),
        ageHours: 26,
        breached: true,
      },
      documents: baseDocuments('case-002'),
    }),
  ];

  const auditEvents: AuditEvent[] = [
    {
      id: 'audit-001',
      caseId: 'case-001',
      action: 'created',
      label: 'Solicitud recibida desde agencia',
      actor: 'Asesor Demo 01',
      toStatus: 'EN_REVISION',
      createdAt: firstCreatedAt,
    },
    {
      id: 'audit-002',
      caseId: 'case-001',
      action: 'rules-executed',
      label: 'Prevalidación automática ejecutada',
      actor: 'Motor de reglas',
      note: 'Se detectó un campo determinístico pendiente.',
      createdAt: nowMinusHours(6.9),
    },
    {
      id: 'audit-003',
      caseId: 'case-002',
      action: 'created',
      label: 'Solicitud recibida desde agencia',
      actor: 'Asesor Demo 02',
      toStatus: 'EN_REVISION',
      createdAt: secondCreatedAt,
    },
    {
      id: 'audit-004',
      caseId: 'case-002',
      action: 'escalate',
      label: 'Caso escalado a Cumplimiento',
      actor: 'Control de Calidad Demo',
      note: 'Indicador FATCA y domicilio por confirmar.',
      fromStatus: 'EN_REVISION',
      toStatus: 'ESCALADO_CUMPLIMIENTO',
      createdAt: nowMinusHours(2),
    },
  ];

  return { version: 3, cases, auditEvents };
}
