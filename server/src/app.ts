import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  APPLICATION_PREFILL_MAX_BYTES,
  generateApplicationPrefillSample,
  pdfPageCount,
  prefillApplicationFromPdf,
} from './applicationPrefill.js';
import { summarizeCase } from './ai.js';
import {
  resolveBootstrapUser,
  resolveDatabaseConfig,
  resolveGeminiConfig,
  resolveMailRuntimeConfig,
  resolveObjectStorageConfig,
  type DatabaseConfig,
  type GeminiConfig,
  type ObjectStorageConfig,
} from './config.js';
import { generateSyntheticContract } from './contractPdf.js';
import { buildCorePayload } from './corePayload.js';
import {
  analyzeDocumentIntelligence,
  asCachedInsight,
  buildLocalDocumentIntelligence,
  documentIntelligenceFingerprint,
} from './documentIntelligence.js';
import { DOCUMENT_PREVIEW_MAX_PAGE, DocumentPreviewCache } from './documentPreview.js';
import { inlineContentDisposition } from './httpHeaders.js';
import { applyVerifiedPdfEvidence, PdfEvidenceLocator } from './pdfEvidenceLocator.js';
import { STAGE_LABELS, STATUS_LABELS, STATUS_PROGRESS } from './labels.js';
import { MailService, type MailSettingsInput } from './mail.js';
import { MysqlStore, UserManagementError, type AuthUser } from './mysqlStore.js';
import { ObjectStorage } from './objectStorage.js';
import { getPolicyCatalog } from './policyCatalog.js';
import { allowedActions, evaluateCaseRules } from './rules.js';
import { JsonStore, type CaseStore } from './store.js';
import { generateSyntheticDocumentPdf } from './syntheticDocumentPdf.js';
import type {
  AfpcCase,
  CaseDetail,
  CaseDocument,
  CaseFacts,
  ClientProfile,
  ProductProfile,
} from './types.js';
import { normalizeAction, transitionCase, WorkflowError } from './workflow.js';
import { APP_VERSION } from './version.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(moduleDir, '../data');

export interface BuildAppOptions {
  dataDir?: string;
  logger?: boolean;
  geminiConfig?: GeminiConfig;
  databaseConfig?: DatabaseConfig | null;
  authDisabled?: boolean;
  objectStorageConfig?: ObjectStorageConfig | null;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
  rememberDevice?: unknown;
}

interface UserParams {
  id: string;
}

interface UserCreateBody {
  username?: unknown;
  displayName?: unknown;
  role?: unknown;
  password?: unknown;
}

interface UserUpdateBody extends UserCreateBody {
  active?: unknown;
}

interface CaseParams {
  id: string;
}

interface DocumentParams extends CaseParams {
  documentId: string;
}

interface GeneratedDocumentParams extends DocumentParams {}

interface DocumentPreviewQuery {
  page?: string;
}

interface CasesQuery {
  status?: string;
  search?: string;
}

interface ActionBody {
  action?: unknown;
  actor?: unknown;
  note?: unknown;
  role?: unknown;
}

interface CaseInput {
  agency?: string;
  advisor?: string;
  assignee?: string;
  scenario?: string;
  client?: Partial<ClientProfile> & { idNumber?: string };
  product?: Partial<ProductProfile>;
  facts?: Partial<CaseFacts>;
}

function hoursBetween(start: string, end: Date): number {
  return Math.max(0, Math.round(((end.getTime() - new Date(start).getTime()) / 3_600_000) * 10) / 10);
}

function withLiveSla(afpcCase: AfpcCase): AfpcCase {
  const now = new Date();
  return {
    ...afpcCase,
    statusLabel: STATUS_LABELS[afpcCase.status],
    currentStage: STAGE_LABELS[afpcCase.status],
    sla: {
      ...afpcCase.sla,
      ageHours: hoursBetween(afpcCase.sla.receivedAt, now),
      breached: now.getTime() > new Date(afpcCase.sla.dueAt).getTime(),
    },
  };
}

function detail(store: CaseStore, afpcCase: AfpcCase): CaseDetail {
  const live = withLiveSla(afpcCase);
  return {
    ...live,
    auditTrail: store.listAudit(live.id),
    canActions: allowedActions(live),
  };
}

function ensureCase(store: CaseStore, caseId: string): AfpcCase {
  const found = store.findCase(caseId);
  if (!found) throw new WorkflowError(`No se encontró el caso ${caseId}.`, 404);
  return found;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const USER_ROLES = ['ADMIN', 'AFILIACIONES', 'CUMPLIMIENTO', 'CONSULTA'] as const;

function userFields(body: UserCreateBody, passwordRequired: boolean) {
  const username = typeof body?.username === 'string' ? body.username.trim().toLocaleLowerCase('es-HN') : '';
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  const role = typeof body?.role === 'string' ? body.role.trim().toUpperCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (username.length < 3 || username.length > 191 || /\s/u.test(username)) {
    throw new WorkflowError('El usuario debe tener entre 3 y 191 caracteres y no contener espacios.', 400);
  }
  if (displayName.length < 2 || displayName.length > 255) {
    throw new WorkflowError('El nombre debe tener entre 2 y 255 caracteres.', 400);
  }
  if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
    throw new WorkflowError('Seleccione un rol válido.', 400);
  }
  if ((passwordRequired || password) && password.length < 12) {
    throw new WorkflowError('La contraseña debe tener al menos 12 caracteres.', 400);
  }
  return { username, displayName, role, ...(password ? { password } : {}) };
}

function isDuplicateEntry(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

function safeContribution(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeFrequency(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const normalized = value.trim().toLocaleLowerCase('es-HN');
  if (normalized === 'mensual') return 'Mensual';
  if (['unico', 'único', 'aporte unico', 'aporte único'].includes(normalized)) return 'Aporte único';
  if (normalized === 'trimestral') return 'Trimestral';
  return value.trim();
}

function normalizePaymentMethod(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const normalized = value.trim().toLocaleLowerCase('es-HN');
  if (['cuenta_occidente', 'débito a cuenta', 'debito a cuenta'].includes(normalized)) {
    return 'Débito a cuenta';
  }
  if (['tarjeta_credito', 'tarjeta de crédito', 'tarjeta de credito'].includes(normalized)) {
    return 'Tarjeta de crédito';
  }
  if (['tarjeta_debito', 'tarjeta de débito', 'tarjeta de debito'].includes(normalized)) {
    return 'Tarjeta de débito';
  }
  if (['transferencia', 'transferencia bancaria'].includes(normalized)) {
    return 'Transferencia bancaria';
  }
  return value.trim();
}

function maskIdentification(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const compact = value.trim();
  if (compact.includes('*')) return compact;
  const visible = compact.replaceAll(/[^0-9A-Za-z]/gu, '').slice(-4) || 'DEMO';
  return `****-****-${visible}`;
}

function safeUploadedFilename(filename: string, fallback: string): string {
  const base = path.basename(filename || fallback);
  const cleaned = base.replaceAll(/[\r\n"\\/]/gu, '_').trim().slice(0, 160);
  return cleaned || fallback;
}

function demoDocumentPackage(caseId: string, createdAt: string): CaseDocument[] {
  const definitions = [
    ['AFFILIATION_FORM', 'Formulario de afiliación sintético.pdf', 2, 34],
    ['IDENTITY', 'Identidad sintética.pdf', 1, 7],
    ['RTN', 'RTN sintético.pdf', 1, 4],
    ['CONTRIBUTION_RECEIPT', 'Comprobante de aporte sintético.pdf', 1, 6],
    ['FINANCIAL_EDUCATION', 'Constancia de educación financiera sintética.pdf', 1, 5],
    ['FATCA', 'Autocertificación FATCA sintética.pdf', 1, 12],
    ['CONTRACT', 'Contrato de afiliación sintético.pdf', 8, 9],
    ['SOURCE_OF_FUNDS', 'Respaldo de procedencia sintético.pdf', 1, 6],
    ['SCREENING', 'Resultado de listas sintético.pdf', 1, 4],
    ['EMAIL_CHECKLIST', 'Correo y lista de verificación sintética.pdf', 1, 3],
  ] as const;
  return definitions.map(([type, name, pages, fieldsExtracted], index) => ({
    id: `${caseId}-doc-${index + 1}`,
    name,
    type,
    status: 'VALID',
    synthetic: true,
    uploadedAt: createdAt,
    mimeType: 'application/pdf',
    pages,
    confidence: roundDemoConfidence(index),
    fieldsExtracted,
  }));
}

function roundDemoConfidence(index: number): number {
  return Math.round((0.95 + (index % 4) * 0.01) * 100) / 100;
}

function mergeCaseInput(current: AfpcCase, input: CaseInput): AfpcCase {
  const updated: AfpcCase = {
    ...current,
    agency: textOr(input.agency, current.agency),
    advisor: textOr(input.advisor, current.advisor),
    assignee: textOr(input.assignee, current.assignee),
    client: { ...current.client, ...(input.client ?? {}) },
    product: { ...current.product, ...(input.product ?? {}) },
    facts: { ...current.facts, ...(input.facts ?? {}) },
    updatedAt: new Date().toISOString(),
    documentIntelligence: undefined,
  };
  updated.product.contributionAmount = safeContribution(
    updated.product.contributionAmount,
    current.product.contributionAmount,
  );
  updated.product.frequency = normalizeFrequency(
    input.product?.frequency,
    current.product.frequency,
  );
  updated.product.paymentMethod = normalizePaymentMethod(
    input.product?.paymentMethod,
    current.product.paymentMethod,
  );
  const evaluation = evaluateCaseRules(updated);
  return {
    ...updated,
    validations: evaluation.validations,
    risk: evaluation.risk,
    progress: Math.max(STATUS_PROGRESS[updated.status], evaluation.progress),
  };
}

function createCaseInput(store: CaseStore, input: CaseInput): AfpcCase {
  const number = store.listCases().length + 1;
  const padded = String(number).padStart(3, '0');
  const createdAt = new Date().toISOString();
  const dueAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const caseId = `case-${padded}`;
  const preparedScenario = ['standard', 'compliance'].includes(input.scenario ?? '');
  const provisional: AfpcCase = {
    id: caseId,
    reference: `AFP-DEMO-${new Date().getFullYear()}-${padded}`,
    synthetic: true,
    status: 'EN_REVISION',
    statusLabel: STATUS_LABELS.EN_REVISION,
    currentStage: STAGE_LABELS.EN_REVISION,
    agency: textOr(input.agency, 'Agencia Demo'),
    advisor: textOr(input.advisor, 'Asesor Demo'),
    assignee: textOr(input.assignee, 'Control de Calidad Demo'),
    createdAt,
    updatedAt: createdAt,
    client: {
      fullName: textOr(input.client?.fullName, `Cliente Sintético ${padded}`),
      idType: input.client?.idType ?? 'DNI',
      idNumberMasked: maskIdentification(
        input.client?.idNumberMasked ?? input.client?.idNumber,
        `DEMO-****-${padded}`,
      ),
      birthDate: input.client?.birthDate,
      nationality: textOr(input.client?.nationality, 'Hondureña'),
      residenceCountry: textOr(input.client?.residenceCountry, 'Honduras'),
      city: textOr(input.client?.city, 'Ciudad Demo'),
      emailMasked: input.client?.emailMasked,
      phoneMasked: input.client?.phoneMasked,
    },
    product: {
      plan: textOr(input.product?.plan, 'Plan Individual de Pensiones'),
      currency: input.product?.currency ?? 'HNL',
      contributionAmount: safeContribution(input.product?.contributionAmount, 500),
      frequency: normalizeFrequency(input.product?.frequency, 'Mensual'),
      paymentMethod: normalizePaymentMethod(input.product?.paymentMethod, 'Débito a cuenta'),
      sourceOfFunds: textOr(input.product?.sourceOfFunds, 'Pendiente de documentar'),
    },
    facts: {
      educationFinancialYear:
        input.facts?.educationFinancialYear ?? (preparedScenario ? new Date().getFullYear() : undefined),
      fatcaPositive: input.facts?.fatcaPositive ?? false,
      addressConsistent: input.facts?.addressConsistent ?? true,
      sourceOfFundsDocumented: input.facts?.sourceOfFundsDocumented ?? preparedScenario,
      signaturesComplete: input.facts?.signaturesComplete ?? preparedScenario,
      beneficiaryPercentTotal: input.facts?.beneficiaryPercentTotal ?? (preparedScenario ? 100 : 0),
      identityVerified: input.facts?.identityVerified ?? preparedScenario,
      pepDeclared: input.facts?.pepDeclared ?? false,
      apnfdDeclared: input.facts?.apnfdDeclared ?? false,
    },
    risk: { level: 'BAJO', score: 0, route: 'REVISION_ESTANDAR', reasons: [] },
    sla: { receivedAt: createdAt, dueAt, ageHours: 0, breached: false },
    documents: preparedScenario ? demoDocumentPackage(caseId, createdAt) : [],
    validations: [],
    progress: STATUS_PROGRESS.EN_REVISION,
  };
  const evaluation = evaluateCaseRules(provisional);
  return {
    ...provisional,
    risk: evaluation.risk,
    validations: evaluation.validations,
    progress: evaluation.progress,
  };
}

function dashboard(store: CaseStore) {
  const cases = store.listCases().map(withLiveSla);
  const auditEvents = cases.flatMap((item) => store.listAudit(item.id));
  const count = (statuses: AfpcCase['status'][]) =>
    cases.filter((item) => statuses.includes(item.status)).length;
  const casesWithReprocess = cases.filter(
    (item) =>
      ['DEVUELTO', 'CORREGIDO'].includes(item.status) ||
      auditEvents.some((event) => event.caseId === item.id && ['case-returned', 'demo-correction'].includes(event.action)),
  ).length;
  const statusOrder: AfpcCase['status'][] = [
    'RECIBIDO',
    'EN_REVISION',
    'DEVUELTO',
    'CORREGIDO',
    'ESCALADO_CUMPLIMIENTO',
    'APROBADO',
    'LISTO_CORE',
    'ARCHIVADO',
  ];
  const today = new Date();
  const daysToShow = 14;
  const volumeByDay = Array.from({ length: daysToShow }, (_unused, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (daysToShow - 1 - index));
    const date = day.toISOString().slice(0, 10);
    return {
      date,
      label: day.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }).replace('.', ''),
      count: cases.filter((item) => item.createdAt.slice(0, 10) === date).length,
    };
  });
  const errors = cases.flatMap((item) => item.validations).filter((item) => item.severity === 'error');
  const warnings = cases.flatMap((item) => item.validations).filter((item) => item.severity === 'warning');
  const documentCount = cases.reduce((sum, item) => sum + item.documents.length, 0);
  const extractedFieldCount = cases.reduce(
    (sum, item) => sum + item.documents.reduce((docSum, document) => docSum + (document.fieldsExtracted ?? 0), 0),
    0,
  );
  const documentIntelligenceSavings = cases.reduce(
    (sum, item) => sum + (item.documentIntelligence?.metrics.estimatedMinutesSaved ?? 0),
    0,
  );
  const estimatedMinutesSaved = documentIntelligenceSavings ||
    Math.max(0, documentCount * 3.5 + extractedFieldCount * 0.5 + auditEvents.filter((event) => event.action === 'application-prefill').length * 18);

  return {
    synthetic: true,
    dataNotice: 'Indicadores calculados desde los expedientes cargados en el portal local.',
    metrics: {
      total: cases.length,
      inReview: count(['RECIBIDO', 'EN_REVISION', 'CORREGIDO']),
      returned: count(['DEVUELTO']),
      compliance: count(['ESCALADO_CUMPLIMIENTO']),
      readyForCore: count(['APROBADO', 'LISTO_CORE']),
      reprocessRate: cases.length ? Math.round((casesWithReprocess / cases.length) * 1000) / 10 : 0,
      avgCycleHours: cases.length
        ? Math.round((cases.reduce((sum, item) => sum + item.sla.ageHours, 0) / cases.length) * 10) / 10
        : 0,
      estimatedHoursSaved: Math.round((estimatedMinutesSaved / 60) * 10) / 10,
    },
    byStatus: statusOrder.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      count: count([status]),
    })),
    volumeByDay,
    recentCases: cases
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5),
    alerts: [
      { level: 'error', message: 'Validaciones obligatorias pendientes', count: errors.length },
      { level: 'warning', message: 'Alertas que requieren revisión humana', count: warnings.length },
      { level: 'PLAZO', message: 'Casos fuera del plazo de atención de la demostración', count: cases.filter((item) => item.sla.breached).length },
    ],
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const dataDir = options.dataDir ?? defaultDataDir;
  const databaseConfig = options.databaseConfig === undefined ? resolveDatabaseConfig() : options.databaseConfig;
  const mysqlStore = !options.dataDir && databaseConfig
    ? new MysqlStore(databaseConfig, dataDir, resolveBootstrapUser())
    : undefined;
  const store: CaseStore = mysqlStore ?? new JsonStore(dataDir);
  const documentPreviewCache = new DocumentPreviewCache({
    cacheDir: path.join(store.dataDir, 'preview-cache'),
  });
  const pdfEvidenceLocator = new PdfEvidenceLocator();
  const geminiConfig = options.geminiConfig ?? resolveGeminiConfig();
  const mailRuntime = resolveMailRuntimeConfig();
  const objectStorageConfig = options.objectStorageConfig === undefined
    ? resolveObjectStorageConfig()
    : options.objectStorageConfig;
  const objectStorage = objectStorageConfig ? new ObjectStorage(objectStorageConfig) : undefined;
  const mailService = mysqlStore
    ? new MailService(mysqlStore.databasePool(), mailRuntime.credentialsKey, objectStorage, geminiConfig)
    : undefined;
  const authEnabled = Boolean(mysqlStore && !options.authDisabled);
  await store.initialize();

  await app.register(cookie);
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 },
  });

  app.setErrorHandler((error, _request, reply) => {
    const genericError = error as { statusCode?: unknown; message?: unknown };
    const statusCode =
      error instanceof WorkflowError
        ? error.statusCode
        : typeof genericError.statusCode === 'number'
          ? genericError.statusCode
          : 500;
    if (statusCode >= 500) app.log.error(error);
    reply.status(statusCode).send({
      error:
        statusCode === 404
          ? 'No encontrado'
          : statusCode >= 500
            ? 'Error interno del servidor'
            : 'Solicitud no válida',
      message:
        statusCode >= 500
          ? 'Ocurrió un error interno en el demo local.'
          : typeof genericError.message === 'string'
            ? genericError.message
            : 'La solicitud no es válida.',
      statusCode,
    });
  });

  app.addHook('onRequest', async (request) => {
    if (!authEnabled || !mysqlStore) return;
    const pathname = request.url.split('?')[0];
    if (pathname === '/api/health' || pathname === '/api/auth/login') return;
    const user = await mysqlStore.resolveSession(request.cookies.occidente_session);
    if (!user) throw new WorkflowError('La sesión no es válida o expiró.', 401);
    (request as FastifyRequest & { authUser?: AuthUser }).authUser = user;
  });

  const requestUser = (request: FastifyRequest): AuthUser | undefined =>
    (request as FastifyRequest & { authUser?: AuthUser }).authUser;

  const requireAdmin = (request: FastifyRequest): AuthUser => {
    const user = requestUser(request);
    if (!user || user.role !== 'ADMIN') throw new WorkflowError('Solo un administrador puede realizar esta acción.', 403);
    return user;
  };

  const ensureAnotherAdmin = async (targetId: string): Promise<void> => {
    if (!mysqlStore) throw new WorkflowError('La gestión de usuarios requiere la conexión MySQL.', 503);
    const users = await mysqlStore.listUsers();
    const target = users.find((user) => user.id === targetId);
    if (target?.active && target.role === 'ADMIN' && users.filter((user) => user.active && user.role === 'ADMIN').length <= 1) {
      throw new WorkflowError('Debe conservar al menos un administrador activo.', 409);
    }
  };

  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    if (!mysqlStore) throw new WorkflowError('La autenticación requiere la conexión MySQL.', 503);
    const username = typeof request.body?.username === 'string' ? request.body.username : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!username.trim() || !password) throw new WorkflowError('Ingrese usuario y contraseña.', 400);
    const user = await mysqlStore.authenticate(username, password);
    if (!user) throw new WorkflowError('Usuario o contraseña incorrectos.', 401);
    const rememberDevice = request.body?.rememberDevice === true;
    const session = await mysqlStore.createSession(user.id, rememberDevice);
    reply.setCookie('occidente_session', session.token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      ...(rememberDevice ? { expires: session.expiresAt } : {}),
    });
    return { user };
  });

  app.get('/api/auth/me', async (request) => ({ user: requestUser(request) }));

  app.post('/api/auth/logout', async (request, reply) => {
    await mysqlStore?.deleteSession(request.cookies.occidente_session);
    reply.clearCookie('occidente_session', { path: '/' });
    return { ok: true };
  });

  app.get('/api/users', async (request) => {
    requireAdmin(request);
    if (!mysqlStore) throw new WorkflowError('La gestión de usuarios requiere la conexión MySQL.', 503);
    return { items: await mysqlStore.listUsers() };
  });

  app.post<{ Body: UserCreateBody }>('/api/users', async (request, reply) => {
    requireAdmin(request);
    if (!mysqlStore) throw new WorkflowError('La gestión de usuarios requiere la conexión MySQL.', 503);
    const user = userFields(request.body, true);
    try {
      const created = await mysqlStore.createManagedUser({ ...user, password: user.password as string });
      return reply.status(201).send({ user: created });
    } catch (error) {
      if (isDuplicateEntry(error)) throw new WorkflowError('Ya existe un usuario con ese identificador.', 409);
      throw error;
    }
  });

  app.patch<{ Params: UserParams; Body: UserUpdateBody }>('/api/users/:id', async (request) => {
    const actor = requireAdmin(request);
    if (!mysqlStore) throw new WorkflowError('La gestión de usuarios requiere la conexión MySQL.', 503);
    const fields = userFields(request.body, false);
    const current = (await mysqlStore.listUsers()).find((user) => user.id === request.params.id);
    if (!current) throw new WorkflowError('No se encontró el usuario.', 404);
    const active = typeof request.body?.active === 'boolean' ? request.body.active : current.active;
    if (actor.id === request.params.id && !active) {
      throw new WorkflowError('No puede desactivar el usuario con el que inició sesión.', 400);
    }
    if (current.active && current.role === 'ADMIN' && (!active || fields.role !== 'ADMIN')) {
      await ensureAnotherAdmin(current.id);
    }
    try {
      const updated = await mysqlStore.updateManagedUser(request.params.id, { ...fields, active });
      if (!updated) throw new WorkflowError('No se encontró el usuario.', 404);
      return { user: updated };
    } catch (error) {
      if (isDuplicateEntry(error)) throw new WorkflowError('Ya existe un usuario con ese identificador.', 409);
      if (error instanceof UserManagementError) throw new WorkflowError(error.message, 409);
      throw error;
    }
  });

  app.delete<{ Params: UserParams }>('/api/users/:id', async (request) => {
    const actor = requireAdmin(request);
    if (!mysqlStore) throw new WorkflowError('La gestión de usuarios requiere la conexión MySQL.', 503);
    if (actor.id === request.params.id) {
      throw new WorkflowError('No puede desactivar el usuario con el que inició sesión.', 400);
    }
    await ensureAnotherAdmin(request.params.id);
    try {
      const user = await mysqlStore.deactivateManagedUser(request.params.id);
      if (!user) throw new WorkflowError('No se encontró el usuario.', 404);
      return { user };
    } catch (error) {
      if (error instanceof UserManagementError) throw new WorkflowError(error.message, 409);
      throw error;
    }
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'afpc-occidente-demo-api',
    version: APP_VERSION,
    mode: 'demo-local',
    timestamp: new Date().toISOString(),
    geminiConfigured: geminiConfig.configured,
    storage: store.storageMode,
    database: mysqlStore?.databaseName,
    objectStorage: mailService?.storageConfigured ? 's3' : 'not-configured',
  }));

  app.get('/api/settings/email', async () => {
    if (!mailService) throw new WorkflowError('El correo requiere la conexión MySQL.', 503);
    return mailService.getSettings();
  });

  app.put<{ Body: MailSettingsInput }>('/api/settings/email', async (request) => {
    if (!mailService) throw new WorkflowError('El correo requiere la conexión MySQL.', 503);
    const user = requestUser(request);
    if (user?.role !== 'ADMIN') throw new WorkflowError('Solo un administrador puede cambiar el correo.', 403);
    const body = request.body;
    if (!body?.emailAddress || !body.username || !body.incomingHost || !body.outgoingHost) {
      throw new WorkflowError('Complete los datos obligatorios del correo.', 400);
    }
    if (![body.incomingPort, body.outgoingPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65_535)) {
      throw new WorkflowError('Los puertos de correo no son válidos.', 400);
    }
    return mailService.updateSettings(body, user.displayName);
  });

  app.post('/api/settings/email/test', async (request) => {
    if (!mailService) throw new WorkflowError('El correo requiere la conexión MySQL.', 503);
    if (requestUser(request)?.role !== 'ADMIN') throw new WorkflowError('Solo un administrador puede probar el correo.', 403);
    return mailService.testConnections();
  });

  app.get<{ Querystring: { limit?: string } }>('/api/incoming-requests', async (request) => {
    if (!mailService) throw new WorkflowError('La bandeja requiere la conexión MySQL.', 503);
    return { items: await mailService.listIncoming(Number(request.query.limit || 100)) };
  });

  app.post('/api/incoming-requests/sync', async () => {
    if (!mailService) throw new WorkflowError('La bandeja requiere la conexión MySQL.', 503);
    return mailService.syncIncoming();
  });

  app.delete<{ Params: CaseParams }>('/api/incoming-requests/:id', async (request) => {
    const actor = requireAdmin(request);
    if (!mailService) throw new WorkflowError('La bandeja requiere la conexión MySQL.', 503);
    try {
      const result = await mailService.deleteIncomingRequest(request.params.id);
      if (!result) throw new WorkflowError('No se encontró la solicitud entrante.', 404);
      return { ok: true, ...result, deletedBy: actor.displayName };
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      app.log.error({ error, incomingRequestId: request.params.id }, 'No se pudo eliminar la solicitud en cascada');
      throw new WorkflowError('No fue posible completar la eliminación en cascada.', 502);
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/api/generated-cases', async (request) => {
    if (!mailService) throw new WorkflowError('Los casos generados requieren la conexión MySQL.', 503);
    return { items: await mailService.listGeneratedCases(Number(request.query.limit || 250)) };
  });

  app.get<{ Params: CaseParams }>('/api/generated-cases/:id', async (request) => {
    if (!mailService) throw new WorkflowError('Los casos generados requieren la conexión MySQL.', 503);
    const generatedCase = await mailService.getGeneratedCase(request.params.id);
    if (!generatedCase) throw new WorkflowError('No se encontró el caso generado.', 404);
    return { case: generatedCase };
  });

  app.post<{ Params: CaseParams }>('/api/generated-cases/:id/analyze', async (request) => {
    if (!mailService) throw new WorkflowError('El análisis documental requiere la conexión MySQL.', 503);
    const analysis = await mailService.analyzeGeneratedCase(request.params.id, true);
    if (!analysis) throw new WorkflowError('No se encontró el caso generado.', 404);
    const generatedCase = await mailService.getGeneratedCase(request.params.id);
    if (!generatedCase) throw new WorkflowError('No se encontró el caso generado.', 404);
    return { case: generatedCase };
  });

  app.get<{ Params: GeneratedDocumentParams }>(
    '/api/generated-cases/:id/documents/:documentId/content',
    async (request, reply) => {
      if (!mailService) throw new WorkflowError('Los documentos requieren la conexión MySQL.', 503);
      try {
        const result = await mailService.getGeneratedDocument(request.params.id, request.params.documentId);
        if (!result) throw new WorkflowError('No se encontró el documento del caso.', 404);
        reply
          .header('content-type', result.document.contentType)
          .header('content-length', String(result.content.length))
          .header('content-disposition', inlineContentDisposition(result.document.filename))
          .header('cache-control', 'private, max-age=300')
          .header('x-document-origin', 's3-private');
        return reply.send(result.content);
      } catch (error) {
        if (error instanceof WorkflowError) throw error;
        app.log.error({ error, documentId: request.params.documentId }, 'No se pudo recuperar el documento desde S3');
        throw new WorkflowError('No fue posible recuperar el documento desde S3.', 502);
      }
    },
  );

  app.delete<{ Params: CaseParams }>('/api/generated-cases/:id', async (request) => {
    const actor = requireAdmin(request);
    if (!mailService) throw new WorkflowError('Los casos generados requieren la conexión MySQL.', 503);
    try {
      const result = await mailService.deleteGeneratedCase(request.params.id);
      if (!result) throw new WorkflowError('No se encontró el caso generado.', 404);
      return {
        ok: true,
        code: result.code,
        deletedObjects: result.deletedObjects,
        deletedBy: actor.displayName,
      };
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      app.log.error({ error, caseId: request.params.id }, 'No se pudo eliminar el caso generado en cascada');
      throw new WorkflowError('No fue posible completar la eliminación en cascada.', 502);
    }
  });

  app.get('/api/dashboard', async () => dashboard(store));

  app.get('/api/policies', async () => getPolicyCatalog());

  app.get('/api/demo/application-prefill-sample', async (_request, reply) => {
    const pdf = await generateApplicationPrefillSample();
    reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        'attachment; filename="solicitud-afpc-sintetica-demo.pdf"',
      )
      .header('content-length', pdf.length)
      .header('cache-control', 'no-store')
      .header('x-document-origin', 'generated-synthetic');
    return reply.send(pdf);
  });

  app.post('/api/application-prefill', async (request, reply) => {
    let fileBuffer: Buffer | undefined;
    let filename = 'solicitud-sintetica.pdf';
    let mimeType = '';
    let synthetic = false;
    let allowAiProcessing = false;

    try {
      for await (const part of request.parts({
        limits: { fileSize: APPLICATION_PREFILL_MAX_BYTES, files: 1, fields: 4 },
      })) {
        if (part.type === 'file') {
          if (fileBuffer) throw new WorkflowError('Solo se admite un PDF por solicitud.', 400);
          mimeType = part.mimetype;
          filename = part.filename;
          fileBuffer = await part.toBuffer();
          if (part.file.truncated) {
            throw new WorkflowError('El PDF supera el límite de 8 MB.', 413);
          }
        } else if (part.fieldname === 'synthetic') {
          synthetic = String(part.value).trim().toLowerCase() === 'true';
        } else if (part.fieldname === 'allowAiProcessing') {
          allowAiProcessing = String(part.value).trim().toLowerCase() === 'true';
        }
      }
    } catch (error) {
      const uploadError = error as { statusCode?: unknown; code?: unknown };
      if (
        uploadError.statusCode === 413 ||
        uploadError.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        throw new WorkflowError('El PDF supera el límite de 8 MB.', 413);
      }
      throw error;
    }

    if (!synthetic) {
      throw new WorkflowError(
        'Esta demostración solo procesa solicitudes declaradas explícitamente como sintéticas.',
        400,
      );
    }
    if (!fileBuffer?.length) throw new WorkflowError('Debe adjuntar un PDF de la solicitud.', 400);
    if (mimeType !== 'application/pdf') {
      throw new WorkflowError('Formato no permitido. Adjunte un archivo PDF.', 415);
    }
    if (fileBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new WorkflowError('El archivo adjunto no contiene una firma PDF válida.', 415);
    }
    const pdfSource = fileBuffer.toString('latin1');
    if (!pdfSource.slice(-2_048).includes('%%EOF')) {
      throw new WorkflowError('El PDF está incompleto o dañado.', 415);
    }
    if (/\/Encrypt\b/u.test(pdfSource)) {
      throw new WorkflowError('No se admiten PDF cifrados o protegidos con contraseña.', 415);
    }
    if (!/\/Type\s*\/Page\b/u.test(pdfSource)) {
      throw new WorkflowError('El PDF no contiene páginas reconocibles.', 415);
    }
    const pages = pdfPageCount(fileBuffer);
    if (pages > 20) {
      throw new WorkflowError('La solicitud no puede superar 20 páginas.', 413);
    }

    const result = await prefillApplicationFromPdf(
      { buffer: fileBuffer, filename },
      geminiConfig,
      allowAiProcessing,
    );
    reply.header('cache-control', 'no-store');
    return result;
  });

  app.get<{ Querystring: CasesQuery }>('/api/cases', async (request) => {
    const status = request.query.status?.trim().toUpperCase();
    const search = request.query.search?.trim().toLocaleLowerCase('es-HN');
    const items = store
      .listCases()
      .map(withLiveSla)
      .filter((item) => !status || item.status === status)
      .filter((item) => {
        if (!search) return true;
        return [
          item.reference,
          item.client.fullName,
          item.client.idNumberMasked,
          item.agency,
          item.advisor,
        ].some((value) => value.toLocaleLowerCase('es-HN').includes(search));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { items, total: items.length };
  });

  app.get<{ Params: CaseParams }>('/api/cases/:id', async (request) =>
    detail(store, ensureCase(store, request.params.id)),
  );

  app.post<{ Body: CaseInput }>('/api/cases', async (request, reply) => {
    const created = createCaseInput(store, request.body ?? {});
    await store.saveCaseAndAudit(created, {
      caseId: created.id,
      action: 'created',
      label: 'Caso sintético creado',
      actor: created.advisor,
      toStatus: created.status,
    });
    reply.status(201);
    return detail(store, created);
  });

  app.patch<{ Params: CaseParams; Body: CaseInput }>('/api/cases/:id', async (request) => {
    const current = ensureCase(store, request.params.id);
    const updated = mergeCaseInput(current, request.body ?? {});
    await store.saveCaseAndAudit(updated, {
      caseId: updated.id,
      action: 'updated',
      label: 'Datos sintéticos del expediente actualizados',
      actor: 'Usuario Demo',
      fromStatus: current.status,
      toStatus: updated.status,
    });
    return detail(store, updated);
  });

  app.post<{ Params: CaseParams; Body: ActionBody }>(
    '/api/cases/:id/actions',
    async (request) => {
      const current = ensureCase(store, request.params.id);
      const action = normalizeAction(request.body?.action);
      const actor = textOr(request.body?.actor, 'Usuario Demo');
      const note = typeof request.body?.note === 'string' ? request.body.note.trim() : undefined;
      const role = typeof request.body?.role === 'string' ? request.body.role.trim() : undefined;
      const transition = transitionCase(current, action, { role, note });
      const auditEvent = await store.saveCaseAndAudit(transition.afpcCase, {
        caseId: current.id,
        action,
        label: transition.label,
        actor,
        note,
        fromStatus: current.status,
        toStatus: transition.afpcCase.status,
      });
      return { case: detail(store, transition.afpcCase), auditEvent };
    },
  );

  app.post<{ Params: CaseParams }>('/api/cases/:id/revalidate', async (request) => {
    const current = ensureCase(store, request.params.id);
    const evaluation = evaluateCaseRules(current);
    const updated: AfpcCase = {
      ...current,
      validations: evaluation.validations,
      risk: evaluation.risk,
      progress: Math.max(STATUS_PROGRESS[current.status], evaluation.progress),
      updatedAt: new Date().toISOString(),
      documentIntelligence: undefined,
    };
    await store.saveCaseAndAudit(updated, {
      caseId: current.id,
      action: 'rules-executed',
      label: 'Reglas de control ejecutadas nuevamente',
      actor: 'Motor de reglas',
      note: `${evaluation.summary.errors} error(es), ${evaluation.summary.warnings} alerta(s).`,
      fromStatus: current.status,
      toStatus: updated.status,
    });
    return { case: detail(store, updated), summary: evaluation.summary };
  });

  app.post<{ Params: CaseParams }>('/api/cases/:id/demo-correction', async (request) => {
    const current = ensureCase(store, request.params.id);
    const documents = current.documents.map((document) =>
      document.type === 'FINANCIAL_EDUCATION'
        ? { ...document, status: 'VALID' as const, uploadedAt: new Date().toISOString() }
        : document,
    );
    const corrected: AfpcCase = {
      ...current,
      status: 'CORREGIDO',
      statusLabel: STATUS_LABELS.CORREGIDO,
      currentStage: STAGE_LABELS.CORREGIDO,
      facts: { ...current.facts, educationFinancialYear: new Date().getFullYear() },
      documents,
      updatedAt: new Date().toISOString(),
      documentIntelligence: undefined,
    };
    const evaluation = evaluateCaseRules(corrected);
    corrected.validations = evaluation.validations;
    corrected.risk = evaluation.risk;
    corrected.progress = Math.max(STATUS_PROGRESS.CORREGIDO, evaluation.progress);
    await store.saveCaseAndAudit(corrected, {
      caseId: current.id,
      action: 'demo-correction',
      label: 'Año de educación financiera corregido',
      actor: 'Asesor Demo',
      note: 'Corrección sintética aplicada para recorrer el flujo del demo.',
      fromStatus: current.status,
      toStatus: corrected.status,
    });
    return { case: detail(store, corrected), summary: evaluation.summary };
  });

  app.get<{ Params: CaseParams }>('/api/cases/:id/core-payload', async (request) =>
    buildCorePayload(withLiveSla(ensureCase(store, request.params.id))),
  );

  app.get<{ Params: CaseParams }>('/api/cases/:id/contract', async (request, reply) => {
    const afpcCase = ensureCase(store, request.params.id);
    const pdf = await generateSyntheticContract(afpcCase);
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="contrato-${afpcCase.reference}.pdf"`)
      .header('cache-control', 'no-store');
    return reply.send(pdf);
  });

  app.get<{ Params: DocumentParams }>(
    '/api/cases/:id/documents/:documentId/content',
    async (request, reply) => {
      const afpcCase = ensureCase(store, request.params.id);
      const sourceDocument = afpcCase.documents.find(
        (document) => document.id === request.params.documentId,
      );
      if (!sourceDocument) {
        throw new WorkflowError(`No se encontró el documento ${request.params.documentId}.`, 404);
      }
      let content: Buffer;
      let mimeType = 'application/pdf';
      if (sourceDocument.storageKey) {
        const uploadsRoot = path.resolve(store.uploadsDir);
        const resolvedPath = path.resolve(store.uploadsDir, sourceDocument.storageKey);
        if (!resolvedPath.startsWith(`${uploadsRoot}${path.sep}`)) {
          throw new WorkflowError('La referencia de almacenamiento no es válida.', 400);
        }
        content = await readFile(resolvedPath);
        mimeType = sourceDocument.mimeType ?? 'application/octet-stream';
      } else {
        content = await generateSyntheticDocumentPdf(afpcCase, sourceDocument);
      }
      const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'bin';
      reply
        .header('content-type', mimeType)
        .header(
          'content-disposition',
          `inline; filename="${sourceDocument.type.toLowerCase()}-${afpcCase.reference}.${extension}"`,
        )
        .header('cache-control', 'no-store')
        .header('x-document-origin', sourceDocument.storageKey ? 'uploaded-synthetic' : 'generated-synthetic');
      return reply.send(content);
    },
  );

  app.get<{ Params: DocumentParams; Querystring: DocumentPreviewQuery }>(
    '/api/cases/:id/documents/:documentId/preview',
    async (request, reply) => {
      const afpcCase = ensureCase(store, request.params.id);
      const sourceDocument = afpcCase.documents.find(
        (document) => document.id === request.params.documentId,
      );
      if (!sourceDocument?.storageKey) {
        throw new WorkflowError('La vista original solo está disponible para archivos cargados.', 404);
      }
      const uploadsRoot = path.resolve(store.uploadsDir);
      const resolvedPath = path.resolve(store.uploadsDir, sourceDocument.storageKey);
      if (!resolvedPath.startsWith(`${uploadsRoot}${path.sep}`)) {
        throw new WorkflowError('La referencia de almacenamiento no es válida.', 400);
      }
      const mimeType = sourceDocument.mimeType ?? 'application/octet-stream';
      if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
        reply.header('content-type', mimeType).header('cache-control', 'private, max-age=3600');
        return reply.send(await readFile(resolvedPath));
      }
      if (mimeType !== 'application/pdf') {
        throw new WorkflowError('Este formato no dispone de vista previa visual.', 415);
      }
      const requestedPage = Number(request.query.page ?? '1');
      const availablePages = Math.min(
        sourceDocument.pages ?? DOCUMENT_PREVIEW_MAX_PAGE,
        DOCUMENT_PREVIEW_MAX_PAGE,
      );
      if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > availablePages) {
        throw new WorkflowError(
          `La página solicitada debe estar entre 1 y ${availablePages}.`,
          400,
        );
      }
      try {
        const preview = await documentPreviewCache.get(
          resolvedPath,
          sourceDocument.storageKey,
          requestedPage,
        );
        reply
          .header('content-type', 'image/png')
          .header('content-length', String(preview.buffer.length))
          .header('cache-control', 'private, max-age=3600, must-revalidate')
          .header('etag', preview.etag)
          .header('x-preview-cache', preview.cacheStatus);
        if (request.headers['if-none-match'] === preview.etag) {
          return reply.status(304).send();
        }
        return reply.send(preview.buffer);
      } catch (error) {
        app.log.warn({ error, documentId: sourceDocument.id }, 'No se pudo generar la vista previa local');
        throw new WorkflowError(
          'No fue posible generar esta vista previa. Verifique que el PDF no esté dañado o protegido.',
          422,
        );
      }
    },
  );

  app.post<{ Params: CaseParams }>('/api/cases/:id/ai-summary', async (request) => {
    const current = ensureCase(store, request.params.id);
    const aiSummary = await summarizeCase(current, geminiConfig);
    const updated = { ...current, aiSummary, updatedAt: new Date().toISOString() };
    await store.saveCaseAndAudit(updated, {
      caseId: current.id,
      action: 'ai-summary',
      label: 'Resumen asistido generado',
      actor: aiSummary.provider === 'gemini' ? 'Gemini' : 'Resumen local',
      note: 'El resumen no constituye aprobación ni decisión automática.',
      fromStatus: current.status,
      toStatus: updated.status,
    });
    return aiSummary;
  });

  app.get<{ Params: CaseParams }>('/api/cases/:id/ai-insights', async (request, reply) => {
    const current = ensureCase(store, request.params.id);
    const fingerprint = documentIntelligenceFingerprint(current);
    if (current.documentIntelligence?.analysis.fingerprint === fingerprint) {
      reply.header('x-ai-cache', 'hit');
      return asCachedInsight(current.documentIntelligence);
    }
    reply.header('x-ai-cache', 'miss');
    return applyVerifiedPdfEvidence(
      buildLocalDocumentIntelligence(current, geminiConfig.configured),
      current,
      store.uploadsDir,
      pdfEvidenceLocator,
    );
  });

  const persistDocumentInsights = async (caseId: string) => {
    const current = ensureCase(store, caseId);
    const fingerprint = documentIntelligenceFingerprint(current);
    if (current.documentIntelligence?.analysis.fingerprint === fingerprint) {
      return asCachedInsight(current.documentIntelligence);
    }
    const insight = await applyVerifiedPdfEvidence(
      await analyzeDocumentIntelligence(current, geminiConfig),
      current,
      store.uploadsDir,
      pdfEvidenceLocator,
    );
    insight.analysis.generatedAt = new Date().toISOString();
    const updated: AfpcCase = {
      ...current,
      documentIntelligence: insight,
      updatedAt: new Date().toISOString(),
    };
    await store.saveCaseAndAudit(updated, {
      caseId: current.id,
      action: 'document-intelligence',
      label: 'Análisis documental inteligente generado',
      actor: insight.analysis.provider === 'gemini' ? 'Gemini + motor determinístico' : 'Motor determinístico local',
      note: `${insight.metrics.documentsProcessed} documentos, ${insight.metrics.fieldsExtracted} campos, ${insight.metrics.anomaliesDetected} ${insight.metrics.anomaliesDetected === 1 ? 'anomalía' : 'anomalías'}. Modo de demostración sintético.`,
      fromStatus: current.status,
      toStatus: updated.status,
    });
    return insight;
  };

  app.post<{ Params: CaseParams }>('/api/cases/:id/ai-insights', async (request, reply) => {
    const insight = await persistDocumentInsights(request.params.id);
    reply.header('x-ai-cache', insight.analysis.cached ? 'hit' : 'miss');
    return insight;
  });

  app.post<{ Params: CaseParams }>(
    '/api/cases/:id/ai-insights/reanalyze',
    async (request, reply) => {
      const insight = await persistDocumentInsights(request.params.id);
      reply.header('x-ai-cache', insight.analysis.cached ? 'hit' : 'miss');
      return insight;
    },
  );

  app.post<{ Params: CaseParams }>('/api/cases/:id/documents', async (request, reply) => {
    const current = ensureCase(store, request.params.id);
    let fileBuffer: Buffer | undefined;
    let mimeType = '';
    let type = 'OTHER';
    let synthetic = false;
    let originalFilename = 'documento-demo';

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileBuffer) throw new WorkflowError('Solo se admite un archivo por solicitud.', 400);
        mimeType = part.mimetype;
        originalFilename = part.filename;
        fileBuffer = await part.toBuffer();
        if (part.file.truncated) throw new WorkflowError('El archivo supera el límite de 10 MB.', 413);
      } else if (part.fieldname === 'type') {
        type = String(part.value).trim().toUpperCase().replaceAll(/[^A-Z0-9_]/gu, '_');
      } else if (part.fieldname === 'synthetic') {
        synthetic = String(part.value).trim().toLowerCase() === 'true';
      }
    }

    if (!synthetic) {
      throw new WorkflowError(
        'Este demo solo acepta documentos declarados explícitamente como sintéticos.',
        400,
      );
    }
    if (!fileBuffer) throw new WorkflowError('Debe adjuntar un archivo.', 400);
    const allowedMimeTypes = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/plain',
    ]);
    if (!allowedMimeTypes.has(mimeType)) {
      throw new WorkflowError('Formato no permitido. Use PDF, PNG, JPG o TXT.', 415);
    }

    const signatures: Record<string, boolean> = {
      'application/pdf': fileBuffer.subarray(0, 5).toString('ascii') === '%PDF-',
      'image/png': fileBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'image/jpeg': fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8,
      'text/plain': true,
    };
    if (!signatures[mimeType]) {
      throw new WorkflowError('El contenido del archivo no coincide con el formato declarado.', 415);
    }

    const extension: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'text/plain': '.txt',
    };
    const documentId = randomUUID();
    const caseUploadDir = path.join(store.uploadsDir, current.id);
    await mkdir(caseUploadDir, { recursive: true });
    const storageKey = path.join(current.id, `${documentId}${extension[mimeType]}`);
    const storedPath = path.join(store.uploadsDir, storageKey);
    await writeFile(storedPath, fileBuffer);
    const document: CaseDocument = {
      id: documentId,
      name: safeUploadedFilename(originalFilename, `Documento demo ${type}${extension[mimeType]}`),
      type,
      status: 'UPLOADED',
      synthetic: true,
      uploadedAt: new Date().toISOString(),
      mimeType,
      size: fileBuffer.length,
      storageKey,
      pages: mimeType === 'application/pdf' ? pdfPageCount(fileBuffer) : 1,
    };
    if (mimeType === 'application/pdf') {
      void documentPreviewCache
        .get(storedPath, storageKey, 1)
        .catch((error) => app.log.warn({ error, documentId }, 'No se pudo anticipar la vista previa local'));
    }
    let replacedTemplate = false;
    const mutation = await store.mutateCaseAndAudit(
      current.id,
      (latest) => {
        const replaceableDocument = latest.documents.find(
          (item) => item.type === type && item.synthetic && !item.storageKey,
        );
        replacedTemplate = Boolean(replaceableDocument);
        const documents = replaceableDocument
          ? latest.documents.map((item) => (item.id === replaceableDocument.id ? document : item))
          : [...latest.documents, document];
        const updated: AfpcCase = {
          ...latest,
          documents,
          updatedAt: new Date().toISOString(),
          documentIntelligence: undefined,
        };
        const evaluation = evaluateCaseRules(updated);
        updated.validations = evaluation.validations;
        updated.risk = evaluation.risk;
        updated.progress = Math.max(STATUS_PROGRESS[updated.status], evaluation.progress);
        return updated;
      },
      (latest, updated) => ({
        caseId: latest.id,
        action: 'document-uploaded',
        label: 'Documento cargado',
        actor: 'Usuario Demo',
        note: replacedTemplate
          ? `Tipo documental: ${type}. Se sustituyó la plantilla de demostración por el archivo cargado.`
          : `Tipo documental: ${type}.`,
        fromStatus: latest.status,
        toStatus: updated.status,
      }),
    );
    const updated = mutation.afpcCase;
    reply.status(201);
    return { case: detail(store, updated), document };
  });

  app.post('/api/demo/reset', async () => {
    await store.reset();
    await documentPreviewCache.clear();
    pdfEvidenceLocator.clear();
    return { ok: true, message: 'Datos sintéticos restaurados.', dashboard: dashboard(store) };
  });

  let mailTimer: NodeJS.Timeout | undefined;
  if (mailService && mailRuntime.credentialsKey) {
    mailTimer = setInterval(() => {
      void mailService.syncIncoming().catch((error) => app.log.warn({ error }, 'No se pudo sincronizar el buzón IMAP'));
    }, mailRuntime.syncIntervalSeconds * 1000);
    mailTimer.unref();
    void mailService.syncIncoming().catch((error) => app.log.warn({ error }, 'Sincronización IMAP inicial pendiente'));
  }

  app.addHook('onClose', async () => {
    if (mailTimer) clearInterval(mailTimer);
    await store.close();
  });

  return app;
}
