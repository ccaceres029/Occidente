import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { buildLocalDocumentIntelligence } from '../src/documentIntelligence.js';
import { evaluateCaseRules } from '../src/rules.js';
import { createSeedDatabase } from '../src/seed.js';

function multipartPdf(
  buffer: Buffer,
  options: { synthetic?: string; filename?: string; mimeType?: string; type?: string } = {},
) {
  const boundary = `----occi-prefill-${Date.now()}-${buffer.length}`;
  const fields = [
    `--${boundary}\r\nContent-Disposition: form-data; name="synthetic"\r\n\r\n${options.synthetic ?? 'true'}\r\n`,
    ...(options.type
      ? [`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${options.type}\r\n`]
      : []),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? 'solicitud-sintetica.pdf'}"\r\nContent-Type: ${options.mimeType ?? 'application/pdf'}\r\n\r\n`,
  ];
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(fields.join(''), 'utf8'),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]),
  };
}

describe('motor de reglas AFPC', () => {
  test('detecta el año faltante como bloqueo determinístico', () => {
    const afpcCase = createSeedDatabase().cases.find((item) => item.id === 'case-001');
    assert.ok(afpcCase);
    const result = evaluateCaseRules(afpcCase);
    assert.equal(result.summary.errors, 1);
    assert.equal(result.summary.canApprove, false);
    assert.ok(result.validations.some((item) => item.code === 'EDUCATION_YEAR_REQUIRED'));
  });

  test('FATCA enruta a Cumplimiento aunque el aporte sea bajo', () => {
    const afpcCase = createSeedDatabase().cases.find((item) => item.id === 'case-002');
    assert.ok(afpcCase);
    const result = evaluateCaseRules(afpcCase);
    assert.equal(result.risk.route, 'CUMPLIMIENTO');
    assert.ok(result.validations.some((item) => item.code === 'FATCA_POSITIVE'));
  });

  test('genera evidencia por campo y explica el año ausente en case-001', () => {
    const afpcCase = createSeedDatabase().cases.find((item) => item.id === 'case-001');
    assert.ok(afpcCase);
    const insight = buildLocalDocumentIntelligence(afpcCase);
    assert.equal(insight.analysis.mode, 'document-pipeline-demo');
    assert.equal(insight.analysis.dataOrigin, 'synthetic-canonical-snapshot');
    assert.equal(insight.metrics.documentsProcessed, 10);
    assert.ok(insight.metrics.fieldsExtracted > 30);
    assert.ok(insight.metrics.averageConfidence > 0.9);
    const missingYear = insight.extractedFields.find(
      (field) =>
        field.documentType === 'FINANCIAL_EDUCATION' &&
        field.field === 'educationFinancialYear',
    );
    assert.ok(missingYear);
    assert.equal(missingYear.status, 'MISSING');
    assert.equal(missingYear.value, null);
    assert.match(missingYear.evidence, /____/u);
    assert.equal(missingYear.boundingBox, undefined);
    assert.equal(missingYear.evidenceLocation, 'unavailable');
    assert.equal(insight.recommendation.decision, 'SUBSANATE');
    assert.ok(insight.anomalies.some((item) => item.ruleCode === 'EDUCATION_YEAR_REQUIRED'));
  });

  test('cruza FATCA y domicilio, y recomienda Cumplimiento para case-002', () => {
    const afpcCase = createSeedDatabase().cases.find((item) => item.id === 'case-002');
    assert.ok(afpcCase);
    const insight = buildLocalDocumentIntelligence(afpcCase);
    const city = insight.consistency.find((item) => item.field === 'city');
    assert.equal(city?.verdict, 'MISMATCH');
    assert.ok(insight.anomalies.some((item) => item.ruleCode === 'FATCA_POSITIVE'));
    assert.ok(insight.anomalies.some((item) => item.ruleCode === 'ADDRESS_MISMATCH'));
    assert.equal(insight.recommendation.decision, 'ESCALATE_COMPLIANCE');
    assert.equal(insight.recommendation.humanDecisionRequired, true);
    assert.equal(insight.sourceOfFunds.alignment, 'CONSISTENT');
  });

  test('no trata el comprobante de aporte como evidencia suficiente de procedencia', () => {
    const source = createSeedDatabase().cases.find((item) => item.id === 'case-001');
    assert.ok(source);
    const afpcCase = {
      ...source,
      documents: source.documents.filter((document) => document.type !== 'SOURCE_OF_FUNDS'),
    };
    const insight = buildLocalDocumentIntelligence(afpcCase);
    assert.equal(insight.sourceOfFunds.alignment, 'INSUFFICIENT');
    assert.ok(
      insight.sourceOfFunds.checks.some(
        (check) => check.code === 'SOF_DOCUMENTED' && check.status === 'FAIL',
      ),
    );
    assert.match(
      insight.sourceOfFunds.checks.find((check) => check.code === 'SOF_DOCUMENTED')?.reason ?? '',
      /por sí solo no demuestra/iu,
    );
  });
});

describe('API local del demo', () => {
  let app: FastifyInstance;
  let dataDir: string;

  before(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'occi-demo-api-'));
    app = await buildApp({
      dataDir,
      geminiConfig: { model: 'gemini-test', configured: false, source: 'none' },
    });
  });

  beforeEach(async () => {
    const response = await app.inject({ method: 'POST', url: '/api/demo/reset' });
    assert.equal(response.statusCode, 200);
  });

  after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  test('expone salud, dashboard y casos consistentes', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().mode, 'demo-local');

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard' });
    assert.equal(dashboard.statusCode, 200);
    assert.equal(dashboard.json().synthetic, true);
    assert.equal(dashboard.json().volumeByDay.length, 14);
    const dashboardPayload = dashboard.json();
    assert.equal(
      dashboardPayload.volumeByDay.reduce((sum: number, item: { count: number }) => sum + item.count, 0),
      dashboardPayload.metrics.total,
    );

    const cases = await app.inject({ method: 'GET', url: '/api/cases?status=EN_REVISION' });
    assert.equal(cases.statusCode, 200);
    assert.equal(cases.json().items.length, 1);
    assert.equal(cases.json().items[0].statusLabel, 'En revisión');

    const caseDetail = await app.inject({ method: 'GET', url: '/api/cases/case-001' });
    assert.equal(caseDetail.statusCode, 200);
    assert.equal(caseDetail.json().currentStage, 'Control de calidad');
    assert.ok(caseDetail.json().validations.some((item: { severity: string }) => item.severity === 'error'));
    assert.ok(Array.isArray(caseDetail.json().auditTrail));
  });

  test('alimenta las mediciones del dashboard desde los expedientes cargados', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/dashboard' });
    assert.equal(before.statusCode, 200);
    const beforePayload = before.json();
    const beforeToday = beforePayload.volumeByDay.at(-1).count;

    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      payload: {
        agency: 'Agencia Prueba Local',
        advisor: 'Asesor de prueba',
        scenario: 'prepared',
        client: {
          fullName: 'Cliente Sintético de Medición',
          idType: 'DNI',
          idNumber: '0801199012345',
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
          sourceOfFunds: 'Remuneración salarial',
        },
      },
    });
    assert.equal(created.statusCode, 201);

    const after = await app.inject({ method: 'GET', url: '/api/dashboard' });
    assert.equal(after.statusCode, 200);
    const afterPayload = after.json();
    assert.equal(afterPayload.metrics.total, beforePayload.metrics.total + 1);
    assert.equal(afterPayload.volumeByDay.at(-1).count, beforeToday + 1);
    assert.equal(afterPayload.metrics.estimatedHoursSaved, beforePayload.metrics.estimatedHoursSaved);
    assert.equal(
      afterPayload.volumeByDay.reduce((sum: number, item: { count: number }) => sum + item.count, 0),
      afterPayload.metrics.total,
    );
  });

  test('recorre corrección, aprobación y preparación para core', async () => {
    const correction = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/demo-correction',
    });
    assert.equal(correction.statusCode, 200);
    assert.equal(correction.json().summary.errors, 0);
    assert.equal(correction.json().case.status, 'CORREGIDO');
    assert.ok(correction.json().case.canActions.includes('approve'));

    const approval = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/actions',
      payload: { action: 'approve', actor: 'Analista Demo', note: 'Revisión humana demo.' },
    });
    assert.equal(approval.statusCode, 200);
    assert.equal(approval.json().case.status, 'APROBADO');
    assert.equal(approval.json().auditEvent.actor, 'Analista Demo');

    const ready = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/actions',
      payload: { action: 'ready-core', actor: 'Operador Core Demo' },
    });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().case.status, 'LISTO_CORE');

    const payload = await app.inject({ method: 'GET', url: '/api/cases/case-001/core-payload' });
    assert.equal(payload.statusCode, 200);
    assert.equal(payload.json().mode, 'simulation');
    assert.equal(payload.json().validation.valid, true);
    assert.equal(payload.json().payload.demoMasked, true);
  });

  test('reserva la aprobación de casos escalados al rol Cumplimiento con justificación', async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/cases/case-002/actions',
      payload: {
        action: 'approve',
        actor: 'Cinthia M. · Usuario B',
        role: 'AFILIACIONES',
        note: 'Intento desde Afiliaciones.',
      },
    });
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.json().message, /rol CUMPLIMIENTO/iu);

    const missingJustification = await app.inject({
      method: 'POST',
      url: '/api/cases/case-002/actions',
      payload: { action: 'approve', actor: 'Analista Cumplimiento', role: 'CUMPLIMIENTO' },
    });
    assert.equal(missingJustification.statusCode, 400);
    assert.match(missingJustification.json().message, /justificación explícita/iu);

    const approved = await app.inject({
      method: 'POST',
      url: '/api/cases/case-002/actions',
      payload: {
        action: 'approve',
        actor: 'Analista Cumplimiento',
        role: 'CUMPLIMIENTO',
        note: 'Revisión reforzada sintética completada.',
      },
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().case.status, 'APROBADO');
  });

  test('crea un caso con las etiquetas enviadas por la UI y enmascara identificación', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cases',
      payload: {
        scenario: 'compliance',
        agency: 'Agencia Demo Norte',
        advisor: 'Asesor Demo',
        client: {
          fullName: 'Andrea Rivera · Cliente Demo',
          idType: 'DNI',
          idNumber: '0000-0000-1234',
          nationality: 'Hondureña',
          residenceCountry: 'Honduras',
          city: 'Tegucigalpa',
        },
        product: {
          plan: 'Plan Individual de Pensiones',
          currency: 'HNL',
          contributionAmount: 2_500,
          frequency: 'Mensual',
          paymentMethod: 'Transferencia bancaria',
          sourceOfFunds: 'Ingresos por servicios profesionales',
        },
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().product.frequency, 'Mensual');
    assert.equal(response.json().product.paymentMethod, 'Transferencia bancaria');
    assert.equal(response.json().client.idNumberMasked, '****-****-1234');
    assert.equal(response.json().risk.route, 'CUMPLIMIENTO');
    assert.equal(response.json().documents.length, 10);
    assert.equal(response.json().validations.some((item: { severity: string }) => item.severity === 'error'), false);
  });

  test('genera un contrato PDF sintético real', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cases/case-001/contract' });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /^application\/pdf/u);
    assert.equal(response.rawPayload.subarray(0, 4).toString('ascii'), '%PDF');
    assert.ok(response.rawPayload.length > 5_000);
  });

  test('descarga una solicitud sintética y la prellena localmente sin persistir el PDF', async () => {
    const sample = await app.inject({
      method: 'GET',
      url: '/api/demo/application-prefill-sample',
    });
    assert.equal(sample.statusCode, 200);
    assert.match(String(sample.headers['content-type']), /^application\/pdf/u);
    assert.equal(sample.headers['x-document-origin'], 'generated-synthetic');
    assert.equal(sample.rawPayload.subarray(0, 5).toString('ascii'), '%PDF-');

    const form = multipartPdf(sample.rawPayload);
    const response = await app.inject({
      method: 'POST',
      url: '/api/application-prefill',
      headers: form.headers,
      payload: form.payload,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().provider, 'local');
    assert.equal(response.json().configured, false);
    assert.equal(response.json().file.pages, 2);
    assert.equal(response.json().file.size, sample.rawPayload.length);
    assert.match(response.json().file.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(response.json().formPatch.client.fullName, 'Sofía Elena Rivera · Cliente Demo');
    assert.equal(response.json().formPatch.product.contributionAmount, 1_250);
    assert.equal(response.json().formPatch.agency, 'Agencia Centro · Demostración');
    assert.equal(response.json().formPatch.product.sourceOfFunds, 'Remuneración salarial');
    assert.equal(response.json().formPatch.scenario, 'standard');
    assert.equal(
      response.json().fields.find((field: { path: string }) => field.path === 'scenario').value,
      'Revisión estándar',
    );
    assert.equal(response.json().fields.length, 15);
    assert.ok(response.json().fields.every((field: { confidence: number }) => field.confidence >= 0 && field.confidence <= 1));
    assert.equal(response.json().requiresHumanReview, true);
    assert.match(response.json().disclaimer, /revisado y confirmado/iu);
    assert.equal(Object.hasOwn(response.json(), 'fileContents'), false);
  });

  test('rechaza archivos sin declaración sintética o sin firma PDF válida', async () => {
    const noSynthetic = multipartPdf(Buffer.from('%PDF-1.4\n%%EOF', 'ascii'), {
      synthetic: 'false',
    });
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/application-prefill',
      headers: noSynthetic.headers,
      payload: noSynthetic.payload,
    });
    assert.equal(blocked.statusCode, 400);
    assert.match(blocked.json().message, /sintéticas/iu);

    const invalid = multipartPdf(Buffer.from('esto no es un pdf', 'utf8'));
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/application-prefill',
      headers: invalid.headers,
      payload: invalid.payload,
    });
    assert.equal(invalidResponse.statusCode, 415);
    assert.match(invalidResponse.json().message, /firma PDF válida/iu);
  });

  test('mantiene vacío el prellenado local de un PDF desconocido y no inventa evidencia', async () => {
    const sample = await app.inject({
      method: 'GET',
      url: '/api/demo/application-prefill-sample',
    });
    const unknownPdf = Buffer.concat([sample.rawPayload, Buffer.from('\n', 'ascii')]);
    const form = multipartPdf(unknownPdf);
    const response = await app.inject({
      method: 'POST',
      url: '/api/application-prefill',
      headers: form.headers,
      payload: form.payload,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().provider, 'local');
    assert.equal(response.json().formPatch.client.fullName, '');
    assert.ok(
      response
        .json()
        .fields.every(
          (field: { confidence: number; status: string; evidence: string }) =>
            field.confidence === 0 &&
            field.status === 'no encontrado' &&
            !field.evidence.includes('Sofía'),
        ),
    );
  });

  test('aplica el límite propio de 8 MB al prellenado', async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
    oversized.write('%PDF-', 0, 'ascii');
    const form = multipartPdf(oversized);
    const response = await app.inject({
      method: 'POST',
      url: '/api/application-prefill',
      headers: form.headers,
      payload: form.payload,
    });
    assert.equal(response.statusCode, 413);
    assert.match(response.json().message, /límite de 8 MB/iu);
  });

  test('carga únicamente documentos declarados como sintéticos', async () => {
    const boundary = '----occi-demo-boundary';
    const chunks = [
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nOTRO\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="synthetic"\r\n\r\ntrue\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="demo.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ];
    const payload = Buffer.concat([
      Buffer.from(chunks.join(''), 'utf8'),
      Buffer.from('%PDF-1.4\n% synthetic demo\n', 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/documents',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().document.synthetic, true);
    assert.equal(response.json().document.name, 'demo.pdf');
  });

  test('conserva todas las cargas paralelas del mismo expediente', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      payload: {
        agency: 'Agencia Prueba Local',
        advisor: 'Asesor de prueba',
        scenario: 'uploaded',
        client: {
          fullName: 'Cliente Sintético Concurrente',
          idType: 'DNI',
          idNumber: '0801199012345',
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
          sourceOfFunds: 'Remuneración salarial',
        },
      },
    });
    assert.equal(created.statusCode, 201);
    const caseId = created.json().id;
    const sample = await app.inject({ method: 'GET', url: '/api/demo/application-prefill-sample' });
    const types = ['OTHER_A', 'OTHER_B', 'OTHER_C'];
    const uploads = await Promise.all(types.map((type, index) => {
      const form = multipartPdf(sample.rawPayload, {
        type,
        filename: `documento-${index + 1}.pdf`,
      });
      return app.inject({
        method: 'POST',
        url: `/api/cases/${caseId}/documents`,
        headers: form.headers,
        payload: form.payload,
      });
    }));
    assert.ok(uploads.every((response) => response.statusCode === 201));

    const detail = await app.inject({ method: 'GET', url: `/api/cases/${caseId}` });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(
      detail.json().documents.map((document: { type: string }) => document.type).sort(),
      types,
    );
    assert.equal(
      detail.json().auditTrail.filter((event: { action: string }) => event.action === 'document-uploaded').length,
      3,
    );
  });

  test('sustituye la plantilla de afiliación por el PDF cargado sin duplicar documentos', async () => {
    const sample = await app.inject({
      method: 'GET',
      url: '/api/demo/application-prefill-sample',
    });
    const form = multipartPdf(sample.rawPayload, { type: 'AFFILIATION_FORM' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/documents',
      headers: form.headers,
      payload: form.payload,
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().case.documents.length, 10);
    const affiliationDocuments = response
      .json()
      .case.documents.filter((document: { type: string }) => document.type === 'AFFILIATION_FORM');
    assert.equal(affiliationDocuments.length, 1);
    assert.equal(affiliationDocuments[0].id, response.json().document.id);
    assert.ok(affiliationDocuments[0].storageKey);

    const content = await app.inject({
      method: 'GET',
      url: `/api/cases/case-001/documents/${response.json().document.id}/content`,
    });
    assert.equal(content.statusCode, 200);
    assert.equal(content.headers['x-document-origin'], 'uploaded-synthetic');
    assert.equal(content.rawPayload.subarray(0, 5).toString('ascii'), '%PDF-');

    const preview = await app.inject({
      method: 'GET',
      url: `/api/cases/case-001/documents/${response.json().document.id}/preview?page=1`,
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers['content-type'], 'image/png');
    assert.equal(preview.rawPayload.subarray(1, 4).toString('ascii'), 'PNG');
    assert.match(preview.headers['x-preview-cache'] ?? '', /^(hit|miss)$/u);
    assert.ok(preview.headers.etag);

    const cachedPreview = await app.inject({
      method: 'GET',
      url: `/api/cases/case-001/documents/${response.json().document.id}/preview?page=1`,
    });
    assert.equal(cachedPreview.statusCode, 200);
    assert.equal(cachedPreview.headers['x-preview-cache'], 'hit');

    const notModified = await app.inject({
      method: 'GET',
      url: `/api/cases/case-001/documents/${response.json().document.id}/preview?page=1`,
      headers: { 'if-none-match': cachedPreview.headers.etag ?? '' },
    });
    assert.equal(notModified.statusCode, 304);

    const invalidPage = await app.inject({
      method: 'GET',
      url: `/api/cases/case-001/documents/${response.json().document.id}/preview?page=99`,
    });
    assert.equal(invalidPage.statusCode, 400);
    assert.match(invalidPage.json().message, /página solicitada/iu);
  });

  test('usa el resumen local cuando Gemini no está configurado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/ai-summary',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().provider, 'local-fallback');
    assert.equal(response.json().configured, false);
    assert.match(response.json().summary, /decisión final corresponde a un analista autorizado/iu);
  });

  test('expone Document Intelligence completo y persiste de forma idempotente', async () => {
    const preview = await app.inject({
      method: 'GET',
      url: '/api/cases/case-001/ai-insights',
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers['x-ai-cache'], 'miss');
    assert.equal(preview.json().analysis.provider, 'local-fallback');
    assert.equal(preview.json().analysis.mode, 'document-pipeline-demo');
    assert.equal(preview.json().metrics.documentsProcessed, 10);
    assert.match(preview.json().analysis.notOcrNotice, /reconocimiento óptico local/iu);
    assert.match(preview.json().analysis.confidenceNotice, /no equivale a cumplimiento/iu);
    assert.ok(preview.json().extractedFields.length > 30);
    assert.ok(preview.json().extractedFields.every((field: { origin: string }) => field.origin === 'synthetic-canonical-template'));
    assert.ok(preview.json().extractedFields.every(
      (field: { boundingBox?: unknown; evidenceLocation: string }) =>
        field.boundingBox === undefined && field.evidenceLocation === 'unavailable',
    ));

    const formDocument = preview
      .json()
      .documents.find((document: { predictedType: string }) => document.predictedType === 'AFFILIATION_FORM');
    assert.ok(formDocument);
    const generatedPdf = await app.inject({ method: 'GET', url: formDocument.contentUrl });
    assert.equal(generatedPdf.statusCode, 200);
    assert.equal(generatedPdf.headers['x-document-origin'], 'generated-synthetic');
    assert.equal(generatedPdf.rawPayload.subarray(0, 4).toString('ascii'), '%PDF');
    assert.ok(generatedPdf.rawPayload.length > 2_000);

    const first = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/ai-insights',
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['x-ai-cache'], 'miss');
    assert.equal(first.json().analysis.cached, false);

    const second = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/ai-insights/reanalyze',
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.headers['x-ai-cache'], 'hit');
    assert.equal(second.json().analysis.cached, true);
    assert.equal(second.json().analysis.id, first.json().analysis.id);

    const caseDetail = await app.inject({ method: 'GET', url: '/api/cases/case-001' });
    const intelligenceEvents = caseDetail
      .json()
      .auditTrail.filter((event: { action: string }) => event.action === 'document-intelligence');
    assert.equal(intelligenceEvents.length, 1);
    assert.equal(caseDetail.json().documentIntelligence.analysis.id, first.json().analysis.id);
    assert.equal(first.json().analysis.syntheticOnly, true);
    assert.equal(Object.hasOwn(first.json(), 'uploadedFileContents'), false);
  });
});
