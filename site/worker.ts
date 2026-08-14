import { summarizeCase } from '../server/src/ai.ts';
import { buildCorePayload } from '../server/src/corePayload.ts';
import { STAGE_LABELS, STATUS_LABELS, STATUS_PROGRESS } from '../server/src/labels.ts';
import { getPolicyCatalog } from '../server/src/policyCatalog.ts';
import { allowedActions, evaluateCaseRules } from '../server/src/rules.ts';
import { createSeedDatabase } from '../server/src/seed.ts';
import type { AfpcCase, AuditEvent, CaseDocument, CaseFacts, ClientProfile, DemoDatabase, ProductProfile } from '../server/src/types.ts';
import { normalizeAction, transitionCase, WorkflowError } from '../server/src/workflow.ts';

interface Env {
  ASSETS: Fetcher;
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

interface ActionBody {
  action?: unknown;
  actor?: unknown;
  note?: unknown;
  role?: unknown;
}

let database: DemoDatabase | undefined;

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function state() {
  database ??= createSeedDatabase();
  return database;
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), { ...init, headers: { ...jsonHeaders, ...(init?.headers ?? {}) } });
}

function errorResponse(error: unknown) {
  const status = error instanceof WorkflowError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : 'No fue posible completar la operación.';
  return json({ error: message }, { status });
}

function clone<T>(value: T): T {
  return structuredClone(value);
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

function listCases() {
  return clone(state().cases);
}

function findCase(caseId: string) {
  const found = state().cases.find((item) => item.id === caseId);
  return found ? clone(found) : undefined;
}

function ensureCase(caseId: string) {
  const found = findCase(caseId);
  if (!found) throw new WorkflowError(`No se encontró el caso ${caseId}.`, 404);
  return found;
}

function listAudit(caseId: string) {
  return clone(
    state().auditEvents
      .filter((event) => event.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

function saveCase(afpcCase: AfpcCase) {
  const db = state();
  const index = db.cases.findIndex((item) => item.id === afpcCase.id);
  if (index === -1) db.cases.push(clone(afpcCase));
  else db.cases[index] = clone(afpcCase);
}

function addAudit(event: Omit<AuditEvent, 'id' | 'createdAt'> & Partial<Pick<AuditEvent, 'id' | 'createdAt'>>) {
  const complete: AuditEvent = {
    ...event,
    id: event.id ?? crypto.randomUUID(),
    createdAt: event.createdAt ?? new Date().toISOString(),
  };
  state().auditEvents.push(complete);
  return clone(complete);
}

function detail(afpcCase: AfpcCase) {
  const live = withLiveSla(afpcCase);
  return {
    ...live,
    auditTrail: listAudit(live.id),
    canActions: allowedActions(live),
  };
}

function dashboard() {
  const items = listCases().map(withLiveSla);
  const total = items.length;
  const count = (status: string) => items.filter((item) => item.status === status).length;
  const reprocess = items.filter((item) =>
    item.status === 'DEVUELTO' || item.auditTrail?.some((event) => event.action === 'demo-correction'),
  ).length;
  const avgCycleHours = total
    ? Math.round((items.reduce((sum, item) => sum + item.sla.ageHours, 0) / total) * 10) / 10
    : 0;

  return {
    metrics: {
      total,
      inReview: count('EN_REVISION') + count('CORREGIDO'),
      returned: count('DEVUELTO'),
      compliance: count('ESCALADO_CUMPLIMIENTO'),
      readyForCore: count('LISTO_CORE'),
      reprocessRate: total ? Math.round((reprocess / total) * 100) : 0,
      avgCycleHours,
      estimatedHoursSaved: Math.max(1, Math.round(total * 1.8)),
    },
    byStatus: Object.entries(STATUS_LABELS).map(([status, label]) => ({ status, label, count: count(status) })),
    recentCases: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    alerts: [
      { level: 'warning', message: 'Expedientes con validaciones pendientes', count: items.filter((item) => item.validations.some((rule) => !rule.resolved)).length },
      { level: 'danger', message: 'SLA vencido o cercano a vencer', count: items.filter((item) => item.sla.breached).length },
    ],
    volumeByDay: [
      { date: '2026-08-09', label: '09 ago', count: 2 },
      { date: '2026-08-10', label: '10 ago', count: 4 },
      { date: '2026-08-11', label: '11 ago', count: 3 },
      { date: '2026-08-12', label: '12 ago', count: 5 },
      { date: '2026-08-13', label: '13 ago', count: total },
    ],
  };
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeContribution(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function maskIdentification(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const compact = value.trim();
  if (compact.includes('*')) return compact;
  const visible = compact.replaceAll(/[^0-9A-Za-z]/gu, '').slice(-4) || 'DEMO';
  return `****-****-${visible}`;
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
    confidence: Math.round((0.95 + (index % 4) * 0.01) * 100) / 100,
    fieldsExtracted,
  }));
}

function createCaseInput(input: CaseInput): AfpcCase {
  const number = state().cases.length + 1;
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
      idNumberMasked: maskIdentification(input.client?.idNumberMasked ?? input.client?.idNumber, `DEMO-****-${padded}`),
      birthDate: input.client?.birthDate,
      nationality: textOr(input.client?.nationality, 'Hondureña'),
      residenceCountry: textOr(input.client?.residenceCountry, 'Honduras'),
      city: textOr(input.client?.city, 'Ciudad Demo'),
      emailMasked: 'd***@demo.invalid',
      phoneMasked: '+504 ****-0000',
    },
    product: {
      plan: textOr(input.product?.plan, 'Plan Individual de Pensiones'),
      currency: input.product?.currency ?? 'HNL',
      contributionAmount: safeContribution(input.product?.contributionAmount, 650),
      frequency: textOr(input.product?.frequency, 'Mensual'),
      paymentMethod: textOr(input.product?.paymentMethod, 'Débito a cuenta'),
      sourceOfFunds: textOr(input.product?.sourceOfFunds, 'Salario'),
    },
    facts: {
      educationFinancialYear: preparedScenario ? new Date().getFullYear() : input.facts?.educationFinancialYear,
      fatcaPositive: input.scenario === 'compliance' || Boolean(input.facts?.fatcaPositive),
      addressConsistent: input.scenario !== 'compliance',
      sourceOfFundsDocumented: true,
      signaturesComplete: true,
      beneficiaryPercentTotal: 100,
      identityVerified: true,
      pepDeclared: false,
      apnfdDeclared: false,
      ...(input.facts ?? {}),
    },
    sla: { receivedAt: createdAt, dueAt, ageHours: 0, breached: false },
    documents: demoDocumentPackage(caseId, createdAt),
    validations: [],
    risk: { level: 'BAJO', score: 0, route: 'REVISION_ESTANDAR', reasons: [] },
    progress: STATUS_PROGRESS.EN_REVISION,
  };
  const evaluation = evaluateCaseRules(provisional);
  return { ...provisional, validations: evaluation.validations, risk: evaluation.risk, progress: evaluation.progress };
}

function prefillResult(file: File) {
  return {
    provider: 'local',
    configured: false,
    file: { name: file.name, size: file.size, pages: 2, sha256: 'demo-browser-shareable' },
    summary: 'Solicitud sintética reconocida. Se extrajeron los campos principales para prellenar el formulario y dejarlos listos para revisión humana.',
    fields: [
      ['client.fullName', 'Nombre completo', 'Laura Demo Occidente', 0.96, 1, 'Campo Nombre del afiliado en formulario sintético.'],
      ['client.idNumber', 'Identidad', '0801-1990-12345', 0.94, 1, 'Número de identificación capturado en la sección de datos generales.'],
      ['agency', 'Agencia', 'Agencia Centro (demo)', 0.91, 1, 'Encabezado de la solicitud.'],
      ['advisor', 'Asesor', 'Asesor Demo 03', 0.89, 1, 'Firma y sello del asesor.'],
      ['product.contributionAmount', 'Aporte', 950, 0.93, 2, 'Monto de contribución mensual declarado.'],
      ['product.sourceOfFunds', 'Procedencia de fondos', 'Salario', 0.9, 2, 'Sección origen de fondos.'],
    ].map(([path, label, value, confidence, page, evidence]) => ({
      path, label, value, confidence, page, evidence, status: confidence < 0.9 ? 'revisar' : 'extraído',
    })),
    formPatch: {
      agency: 'Agencia Centro (demo)',
      advisor: 'Asesor Demo 03',
      client: {
        fullName: 'Laura Demo Occidente',
        idType: 'DNI',
        idNumber: '0801-1990-12345',
        nationality: 'Hondureña',
        residenceCountry: 'Honduras',
        city: 'Tegucigalpa',
      },
      product: {
        plan: 'Plan Individual de Pensiones',
        currency: 'HNL',
        contributionAmount: 950,
        frequency: 'Mensual',
        paymentMethod: 'Débito a cuenta',
        sourceOfFunds: 'Salario',
      },
      scenario: 'standard',
    },
    warnings: ['Prellenado de demostración: cada campo debe revisarse antes de crear el expediente.'],
    requiresHumanReview: true,
    disclaimer: 'Resultado sintético para demostración compartible; no procesa datos reales.',
  };
}

function demoPdf(title: string) {
  const body = `Demo sintético AFPC Occidente\\n${title}\\nNo usar con datos reales.`;
  const escaped = body.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  return `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${escaped.length + 64}>>stream
BT /F1 14 Tf 72 720 Td (${escaped}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000214 00000 n 
0000000345 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
415
%%EOF`;
}

async function handleApi(request: Request, url: URL) {
  try {
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/health') {
      return json({ status: 'ok', service: 'afpc-demo-site', mode: 'sites-shareable', timestamp: new Date().toISOString(), geminiConfigured: false });
    }
    if (method === 'GET' && pathname === '/api/dashboard') return json(dashboard());
    if (method === 'POST' && pathname === '/api/demo/reset') {
      database = createSeedDatabase();
      return json({ ok: true, message: 'Datos sintéticos restaurados.', dashboard: dashboard() });
    }
    if (method === 'GET' && pathname === '/api/policies') return json(getPolicyCatalog());
    if (method === 'GET' && pathname === '/api/demo/application-prefill-sample') {
      return new Response(demoPdf('Solicitud de prueba para prellenado'), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': "inline; filename*=UTF-8''Solicitud-AFPC-sintetica.pdf",
          'cache-control': 'no-store',
        },
      });
    }
    if (method === 'POST' && pathname === '/api/application-prefill') {
      const form = await request.formData();
      const file = form.get('file');
      return json(prefillResult(file instanceof File ? file : new File([demoPdf('Solicitud sintética')], 'Solicitud-AFPC-sintetica.pdf', { type: 'application/pdf' })));
    }
    if (method === 'GET' && pathname === '/api/cases') {
      const status = url.searchParams.get('status')?.trim().toUpperCase();
      const search = url.searchParams.get('search')?.trim().toLocaleLowerCase('es-HN');
      const items = listCases()
        .map(withLiveSla)
        .filter((item) => !status || item.status === status)
        .filter((item) => {
          if (!search) return true;
          return [item.reference, item.client.fullName, item.client.idNumberMasked, item.agency, item.advisor]
            .some((value) => value.toLocaleLowerCase('es-HN').includes(search));
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json({ items, total: items.length });
    }

    const caseMatch = pathname.match(/^\/api\/cases\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (caseMatch) {
      const [, encodedCaseId, segment, thirdSegment] = caseMatch;
      const caseId = decodeURIComponent(encodedCaseId);
      if (method === 'GET' && !segment) return json(detail(ensureCase(caseId)));
      if (method === 'POST' && segment === 'actions') {
        const current = ensureCase(caseId);
        const body = await request.json().catch(() => ({})) as ActionBody;
        const action = normalizeAction(body.action);
        const transition = transitionCase(current, action, {
          role: typeof body.role === 'string' ? body.role : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
        });
        saveCase(transition.afpcCase);
        const auditEvent = addAudit({
          caseId,
          action,
          label: transition.label,
          actor: textOr(body.actor, 'Usuario Demo'),
          note: typeof body.note === 'string' ? body.note : undefined,
          fromStatus: current.status,
          toStatus: transition.afpcCase.status,
        });
        return json({ case: detail(transition.afpcCase), auditEvent });
      }
      if (method === 'POST' && segment === 'revalidate') {
        const current = ensureCase(caseId);
        const evaluation = evaluateCaseRules(current);
        const updated = {
          ...current,
          validations: evaluation.validations,
          risk: evaluation.risk,
          progress: Math.max(STATUS_PROGRESS[current.status], evaluation.progress),
          updatedAt: new Date().toISOString(),
          documentIntelligence: undefined,
        };
        saveCase(updated);
        addAudit({
          caseId,
          action: 'rules-executed',
          label: 'Reglas de control ejecutadas nuevamente',
          actor: 'Motor de reglas',
          note: `${evaluation.summary.errors} error(es), ${evaluation.summary.warnings} alerta(s).`,
          fromStatus: current.status,
          toStatus: updated.status,
        });
        return json({ case: detail(updated), summary: evaluation.summary });
      }
      if (method === 'POST' && segment === 'demo-correction') {
        const current = ensureCase(caseId);
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
        saveCase(corrected);
        addAudit({
          caseId,
          action: 'demo-correction',
          label: 'Año de educación financiera corregido',
          actor: 'Asesor Demo',
          note: 'Corrección sintética aplicada para recorrer el flujo del demo.',
          fromStatus: current.status,
          toStatus: corrected.status,
        });
        return json({ case: detail(corrected), summary: evaluation.summary });
      }
      if (method === 'GET' && segment === 'core-payload') return json(buildCorePayload(withLiveSla(ensureCase(caseId))));
      if (method === 'GET' && segment === 'contract') {
        return new Response(demoPdf(`Contrato ${ensureCase(caseId).reference}`), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
      }
      if (method === 'POST' && segment === 'ai-summary') {
        const current = ensureCase(caseId);
        const aiSummary = await summarizeCase(current, { configured: false, apiKey: '', model: 'local-demo' });
        const updated = { ...current, aiSummary, updatedAt: new Date().toISOString() };
        saveCase(updated);
        addAudit({
          caseId,
          action: 'ai-summary',
          label: 'Resumen asistido generado',
          actor: 'Resumen local',
          note: 'El resumen no constituye aprobación ni decisión automática.',
          fromStatus: current.status,
          toStatus: updated.status,
        });
        return json(aiSummary);
      }
      if (segment === 'ai-insights') {
        return json({ error: 'La inteligencia documental usa el modo local del navegador en la versión compartible.' }, { status: 404 });
      }
      if (method === 'POST' && segment === 'documents') {
        const current = ensureCase(caseId);
        const form = await request.formData();
        const file = form.get('file');
        const typeValue = String(form.get('type') ?? 'OTHER').trim().toUpperCase().replaceAll(/[^A-Z0-9_]/gu, '_') || 'OTHER';
        const document: CaseDocument = {
          id: crypto.randomUUID(),
          name: file instanceof File ? file.name : `Documento demo ${typeValue}.pdf`,
          type: typeValue,
          status: 'UPLOADED',
          synthetic: true,
          uploadedAt: new Date().toISOString(),
          mimeType: file instanceof File ? file.type || 'application/pdf' : 'application/pdf',
          size: file instanceof File ? file.size : undefined,
          pages: 1,
        };
        const replaceable = current.documents.find((item) => item.type === typeValue && item.synthetic);
        const documents = replaceable
          ? current.documents.map((item) => (item.id === replaceable.id ? document : item))
          : [...current.documents, document];
        const updated = { ...current, documents, updatedAt: new Date().toISOString(), documentIntelligence: undefined };
        const evaluation = evaluateCaseRules(updated);
        updated.validations = evaluation.validations;
        updated.risk = evaluation.risk;
        updated.progress = Math.max(STATUS_PROGRESS[updated.status], evaluation.progress);
        saveCase(updated);
        addAudit({
          caseId,
          action: 'document-uploaded',
          label: 'Documento cargado',
          actor: 'Usuario Demo',
          note: `Tipo documental: ${typeValue}. Archivo registrado solo para la sesión de demostración.`,
          fromStatus: current.status,
          toStatus: updated.status,
        });
        return json({ case: detail(updated), document }, { status: 201 });
      }
      if (method === 'GET' && segment === 'documents' && thirdSegment) {
        return new Response(demoPdf(`Documento ${thirdSegment}`), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
      }
    }

    if (method === 'POST' && pathname === '/api/cases') {
      const body = await request.json().catch(() => ({})) as CaseInput;
      const created = createCaseInput(body);
      saveCase(created);
      addAudit({
        caseId: created.id,
        action: 'created',
        label: 'Caso sintético creado',
        actor: created.advisor,
        toStatus: created.status,
      });
      return json(detail(created), { status: 201 });
    }

    return json({ error: 'Ruta no disponible en el demo compartible.' }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function serveAsset(request: Request, env: Env) {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) return assetResponse;
  if (!url.pathname.includes('.')) {
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  return assetResponse;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, url);
    return serveAsset(request, env);
  },
};
