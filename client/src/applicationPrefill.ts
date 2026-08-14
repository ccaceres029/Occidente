import type {
  ApplicationPrefillField,
  ApplicationPrefillFormPatch,
  ApplicationPrefillResponse,
  CreateCaseInput,
} from './types';

const nonEmptyString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const comparable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const normalizeAgency = (value: string) => {
  const normalized = comparable(value);
  if (normalized.includes('centro')) return 'Agencia Centro · Demostración';
  if (normalized.includes('proceres')) return 'Agencia Próceres · Demostración';
  if (normalized.includes('san pedro')) return 'Agencia San Pedro · Demostración';
  return value;
};

const normalizeIdentityType = (value: string) => {
  const normalized = comparable(value).replaceAll('_', ' ');
  if (normalized === 'dni' || normalized.includes('national id') || normalized.includes('identidad')) return 'DNI';
  if (normalized.includes('passport') || normalized.includes('pasaporte')) return 'Pasaporte';
  if (normalized.includes('residence') || normalized.includes('residencia')) return 'Carnet de residencia';
  return value;
};

const normalizeSourceOfFunds = (value: string) => {
  const normalized = comparable(value);
  if (normalized.includes('salari') || normalized.includes('remuneracion')) return 'Remuneración salarial';
  if (normalized.includes('servicio') || normalized.includes('profesional')) return 'Ingresos por servicios profesionales';
  if (normalized.includes('venta') && normalized.includes('bien')) return 'Venta de bienes';
  if (normalized.includes('ahorro')) return 'Ahorros acumulados';
  if (normalized.includes('remesa')) return 'Remesas';
  if (normalized.includes('prestacion')) return 'Prestaciones laborales';
  return value;
};

export const applicationPrefillCriticalPaths = new Set([
  'client.idNumber',
  'product.contributionAmount',
  'product.sourceOfFunds',
  'scenario',
]);

const supportedPaths = new Set([
  'agency',
  'advisor',
  'client.fullName',
  'client.idType',
  'client.idNumber',
  'client.nationality',
  'client.residenceCountry',
  'client.city',
  'product.plan',
  'product.currency',
  'product.contributionAmount',
  'product.frequency',
  'product.paymentMethod',
  'product.sourceOfFunds',
  'scenario',
]);

export const isApplicationPrefillFieldSupported = (path: string) => supportedPaths.has(path);

export function applyApplicationPrefill(
  current: CreateCaseInput,
  patch: ApplicationPrefillFormPatch,
): CreateCaseInput {
  const amount = patch.product?.contributionAmount;
  const contributionAmount = typeof amount === 'number' && Number.isFinite(amount) && amount > 0
    ? amount
    : current.product.contributionAmount;
  const requestedScenario = comparable(patch.scenario || '');
  const scenario = requestedScenario === 'standard' || requestedScenario === 'estandar'
    ? 'standard'
    : requestedScenario === 'compliance' || requestedScenario === 'cumplimiento'
      ? 'compliance'
      : current.scenario;
  const agency = nonEmptyString(patch.agency, current.agency);
  const idType = nonEmptyString(patch.client?.idType, current.client.idType);
  const sourceOfFunds = nonEmptyString(patch.product?.sourceOfFunds, current.product.sourceOfFunds);

  return {
    ...current,
    agency: normalizeAgency(agency),
    advisor: nonEmptyString(patch.advisor, current.advisor),
    client: {
      fullName: nonEmptyString(patch.client?.fullName, current.client.fullName),
      idType: normalizeIdentityType(idType),
      idNumber: nonEmptyString(patch.client?.idNumber, current.client.idNumber),
      nationality: nonEmptyString(patch.client?.nationality, current.client.nationality),
      residenceCountry: nonEmptyString(patch.client?.residenceCountry, current.client.residenceCountry),
      city: nonEmptyString(patch.client?.city, current.client.city),
    },
    product: {
      plan: nonEmptyString(patch.product?.plan, current.product.plan),
      currency: nonEmptyString(patch.product?.currency, current.product.currency).toUpperCase(),
      contributionAmount,
      frequency: nonEmptyString(patch.product?.frequency, current.product.frequency),
      paymentMethod: nonEmptyString(patch.product?.paymentMethod, current.product.paymentMethod),
      sourceOfFunds: normalizeSourceOfFunds(sourceOfFunds),
    },
    scenario,
  };
}

export function normalizeConfidence(confidence: number) {
  if (!Number.isFinite(confidence)) return 0;
  const normalized = confidence > 1 ? confidence / 100 : confidence;
  return Math.round(Math.min(1, Math.max(0, normalized)) * 100);
}

export function isLowConfidenceField(field: ApplicationPrefillField) {
  const status = field.status.toUpperCase();
  return normalizeConfidence(field.confidence) < 75
    || status.includes('LOW')
    || status.includes('REVIEW')
    || status.includes('MISSING')
    || status.includes('BAJA')
    || status.includes('REVIS');
}

export function applicationPrefillStatusLabel(status: string) {
  const labels: Record<string, string> = {
    EXTRACTED: 'Extraído',
    APPLIED: 'Aplicado',
    HIGH_CONFIDENCE: 'Confianza alta',
    MEDIUM_CONFIDENCE: 'Revisar',
    LOW_CONFIDENCE: 'Confianza baja',
    REVIEW: 'Revisión necesaria',
    MISSING: 'No identificado',
    VALID: 'Válido',
    WARNING: 'Con alerta',
  };
  return labels[status.toUpperCase()] || status.replaceAll('_', ' ').toLocaleLowerCase('es');
}

export function applicationPrefillProviderLabel(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized.includes('gemini')) return 'Gemini';
  if (normalized.includes('local')) return 'Motor local de contingencia';
  return 'Motor de inteligencia documental';
}

export function applicationPrefillFileName(result: ApplicationPrefillResponse) {
  return typeof result.file === 'string' ? result.file : result.file.name || 'Solicitud sintética.pdf';
}

export function applicationPrefillSummary(result: ApplicationPrefillResponse) {
  if (typeof result.summary === 'string' && result.summary.trim()) return result.summary;
  const extracted = result.fields.filter((field) => field.value !== null && field.value !== '').length;
  const lowConfidence = result.fields.filter(isLowConfidenceField).length;
  return `${extracted} campos identificados${lowConfidence ? `; ${lowConfidence} requieren revisión` : ' con evidencia disponible'}.`;
}

export function defaultApplicationPrefillSelection(fields: ApplicationPrefillField[]) {
  return new Set(fields
    .filter((field) => supportedPaths.has(field.path))
    .filter((field) => field.value !== null && field.value !== '')
    .filter((field) => !isLowConfidenceField(field))
    .filter((field) => !applicationPrefillCriticalPaths.has(field.path))
    .map((field) => field.path));
}

export function selectApplicationPrefillPatch(
  patch: ApplicationPrefillFormPatch,
  selectedPaths: Set<string>,
): ApplicationPrefillFormPatch {
  const selected: ApplicationPrefillFormPatch = {};
  if (selectedPaths.has('agency') && patch.agency) selected.agency = patch.agency;
  if (selectedPaths.has('advisor') && patch.advisor) selected.advisor = patch.advisor;
  if (selectedPaths.has('scenario') && patch.scenario) selected.scenario = patch.scenario;

  const client = Object.fromEntries(Object.entries(patch.client || {})
    .filter(([key]) => selectedPaths.has(`client.${key}`))) as Partial<CreateCaseInput['client']>;
  const product = Object.fromEntries(Object.entries(patch.product || {})
    .filter(([key]) => selectedPaths.has(`product.${key}`))) as Partial<CreateCaseInput['product']>;
  if (Object.keys(client).length) selected.client = client;
  if (Object.keys(product).length) selected.product = product;
  return selected;
}
