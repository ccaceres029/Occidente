import { REQUIRED_DOCUMENTS } from './rules.js';

export interface PolicyRule {
  code: string;
  title: string;
  domain: string;
  severity: 'error' | 'warning' | 'info';
  trigger: string;
  action: string;
  owner: string;
  evidence: string[];
  policyRef: string;
  configurable: boolean;
  status: 'Activo' | 'Pendiente de validación';
}

export interface PolicyCatalog {
  version: string;
  mode: string;
  updatedAt: string;
  summary: {
    activeRules: number;
    blockingRules: number;
    complianceRules: number;
    configurableRules: number;
  };
  documentMatrix: Array<{
    type: string;
    label: string;
    condition: string;
    owner: string;
    policyRef: string;
  }>;
  riskBands: Array<{
    range: string;
    route: string;
    review: string;
    policyRef: string;
  }>;
  rules: PolicyRule[];
  disclaimers: string[];
}

const rules: PolicyRule[] = [
  {
    code: 'MISSING_REQUIRED_DOCUMENT',
    title: 'Documento obligatorio pendiente',
    domain: 'Completitud documental',
    severity: 'error',
    trigger: 'Falta cualquiera de los documentos mínimos configurados para el expediente.',
    action: 'Bloquea la aprobación y solicita subsanación a agencia.',
    owner: 'Control de calidad',
    evidence: REQUIRED_DOCUMENTS.map((item) => item.label),
    policyRef: 'Matriz documental demo v0.1',
    configurable: true,
    status: 'Activo',
  },
  {
    code: 'EDUCATION_YEAR_REQUIRED',
    title: 'Año de constancia de educación financiera',
    domain: 'Completitud documental',
    severity: 'error',
    trigger: 'La constancia contiene día y mes, pero el año no está capturado.',
    action: 'Bloquea aprobación hasta corregir el campo faltante.',
    owner: 'Control de calidad',
    evidence: ['Constancia de educación financiera'],
    policyRef: 'Control de completitud documental',
    configurable: true,
    status: 'Activo',
  },
  {
    code: 'IDENTITY_NOT_VERIFIED',
    title: 'Identidad no verificada',
    domain: 'Conozca a su cliente',
    severity: 'error',
    trigger: 'La identidad no ha sido validada contra el documento presentado.',
    action: 'Bloquea aprobación y requiere validación humana.',
    owner: 'Control de calidad',
    evidence: ['Documento de identidad', 'Formulario de afiliación'],
    policyRef: 'Debida diligencia del cliente',
    configurable: false,
    status: 'Activo',
  },
  {
    code: 'SOURCE_OF_FUNDS_UNSUPPORTED',
    title: 'Procedencia de fondos sin respaldo',
    domain: 'Procedencia de fondos',
    severity: 'error',
    trigger: 'La procedencia declarada no coincide con evidencia documental suficiente.',
    action: 'Bloquea aprobación y solicita documentos de respaldo según F-AFPC-18-V2.',
    owner: 'Control de calidad',
    evidence: ['Formulario F-AFPC-18-V2', 'Estado de cuenta', 'Constancia o comprobante de origen'],
    policyRef: 'F-AFPC-18-V2',
    configurable: true,
    status: 'Activo',
  },
  {
    code: 'ADDRESS_MISMATCH',
    title: 'Domicilio requiere confirmación',
    domain: 'Consistencia del expediente',
    severity: 'warning',
    trigger: 'La ciudad o residencia declarada difiere entre formulario y documentos.',
    action: 'Permite continuar con revisión reforzada y deja alerta para confirmación.',
    owner: 'Afiliaciones',
    evidence: ['Formulario de afiliación', 'Documento de identidad', 'Autocertificación FATCA'],
    policyRef: 'Consistencia del expediente',
    configurable: true,
    status: 'Activo',
  },
  {
    code: 'BENEFICIARY_PERCENT_TOTAL',
    title: 'Porcentaje de beneficiarios inválido',
    domain: 'Formulario de afiliación',
    severity: 'error',
    trigger: 'La suma de beneficiarios directos o contingentes no es exactamente 100%.',
    action: 'Bloquea aprobación hasta corregir distribución.',
    owner: 'Afiliaciones',
    evidence: ['Formulario F-AFPC-16-V2'],
    policyRef: 'F-AFPC-16-V2',
    configurable: false,
    status: 'Activo',
  },
  {
    code: 'SIGNATURES_PENDING',
    title: 'Firmas pendientes de confirmación',
    domain: 'Formalización',
    severity: 'warning',
    trigger: 'El expediente no tiene confirmación de firmas exigibles para la etapa.',
    action: 'Permite revisión, pero advierte antes de preparar datos para sistema central.',
    owner: 'Afiliaciones',
    evidence: ['Contrato de afiliación', 'Declaración jurada', 'Constancia de educación financiera'],
    policyRef: 'Contrato y constancias del expediente',
    configurable: true,
    status: 'Activo',
  },
  {
    code: 'FATCA_POSITIVE',
    title: 'Indicador FATCA positivo',
    domain: 'Cumplimiento',
    severity: 'warning',
    trigger: 'El cliente declara una condición asociada a FATCA.',
    action: 'Enruta a Cumplimiento y exige decisión humana documentada.',
    owner: 'Cumplimiento',
    evidence: ['Autocertificación FATCA', 'Formulario de afiliación'],
    policyRef: 'Autocertificación FATCA',
    configurable: false,
    status: 'Activo',
  },
  {
    code: 'PEP_DECLARED',
    title: 'Condición PEP declarada',
    domain: 'Cumplimiento',
    severity: 'warning',
    trigger: 'El cliente declara haber desempeñado cargo público o condición equivalente.',
    action: 'Enruta a Cumplimiento para debida diligencia reforzada.',
    owner: 'Cumplimiento',
    evidence: ['Formulario de afiliación', 'Resultado de listas', 'Soporte de análisis'],
    policyRef: 'Debida diligencia reforzada',
    configurable: false,
    status: 'Activo',
  },
  {
    code: 'APNFD_DECLARED',
    title: 'Actividad APNFD declarada',
    domain: 'Perfil económico',
    severity: 'info',
    trigger: 'El cliente declara actividad o profesión no financiera designada.',
    action: 'Genera recordatorio para validar actividad económica y respaldos aplicables.',
    owner: 'Afiliaciones',
    evidence: ['Formulario de afiliación', 'Respaldo de actividad económica'],
    policyRef: 'Perfil económico del cliente',
    configurable: true,
    status: 'Activo',
  },
  {
    code: 'CONTRIBUTION_ENHANCED_REVIEW',
    title: 'Aporte en banda reforzada',
    domain: 'Perfil transaccional',
    severity: 'info',
    trigger: 'El aporte supera 2,000 en la moneda indicada.',
    action: 'Enruta a Cumplimiento según umbral configurable del demo.',
    owner: 'Cumplimiento',
    evidence: ['Comprobante de aporte', 'Respaldo de procedencia de fondos'],
    policyRef: 'Umbral demo pendiente de validación',
    configurable: true,
    status: 'Pendiente de validación',
  },
  {
    code: 'CONTRIBUTION_REINFORCED_REVIEW',
    title: 'Aporte con revisión reforzada',
    domain: 'Perfil transaccional',
    severity: 'info',
    trigger: 'El aporte es mayor a 1,000 y menor o igual a 2,000 en la moneda indicada.',
    action: 'Mantiene revisión reforzada en Afiliaciones.',
    owner: 'Afiliaciones',
    evidence: ['Comprobante de aporte', 'Respaldo de procedencia de fondos'],
    policyRef: 'Umbral demo pendiente de validación',
    configurable: true,
    status: 'Pendiente de validación',
  },
];

export function getPolicyCatalog(): PolicyCatalog {
  const blockingRules = rules.filter((rule) => rule.severity === 'error').length;
  const complianceRules = rules.filter((rule) => rule.owner === 'Cumplimiento').length;
  const configurableRules = rules.filter((rule) => rule.configurable).length;

  return {
    version: 'Parametrización demo v0.2',
    mode: 'Lectura local · datos sintéticos',
    updatedAt: '2026-08-12T00:00:00.000Z',
    summary: {
      activeRules: rules.length,
      blockingRules,
      complianceRules,
      configurableRules,
    },
    documentMatrix: REQUIRED_DOCUMENTS.map((item) => ({
      type: item.type,
      label: item.label,
      condition: 'Requerido para afiliación individual en el demo',
      owner: 'Control de calidad',
      policyRef: 'Matriz documental demo v0.1',
    })),
    riskBands: [
      {
        range: '0 a 1,000',
        route: 'Revisión estándar',
        review: 'Filtro documental y consistencia básica.',
        policyRef: 'Umbral demo pendiente de validación',
      },
      {
        range: 'Mayor a 1,000 y hasta 2,000',
        route: 'Revisión reforzada',
        review: 'Control de calidad valida procedencia, perfil económico y consistencia.',
        policyRef: 'Umbral demo pendiente de validación',
      },
      {
        range: 'Mayor a 2,000',
        route: 'Cumplimiento',
        review: 'Escalamiento automático cuando el monto supera la banda configurada.',
        policyRef: 'Umbral demo pendiente de validación',
      },
      {
        range: 'FATCA, PEP o alerta material',
        route: 'Cumplimiento',
        review: 'Escalamiento por condición regulatoria aunque el aporte sea bajo.',
        policyRef: 'Debida diligencia reforzada',
      },
    ],
    rules,
    disclaimers: [
      'La parametrización es demostrativa y debe ser validada por Banco de Occidente Honduras antes de usarse en producción.',
      'La IA puede extraer, resumir y sugerir alertas; las reglas críticas y la aprobación final requieren control humano.',
      'Los umbrales monetarios son ilustrativos y quedan pendientes de moneda, frecuencia y definición normativa interna.',
    ],
  };
}
