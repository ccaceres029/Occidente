import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  applyVerifiedPdfEvidence,
  parsePdftotextBoundingBoxes,
  PdfEvidenceLocator,
} from '../src/pdfEvidenceLocator.js';
import { buildLocalDocumentIntelligence } from '../src/documentIntelligence.js';
import { createSeedDatabase } from '../src/seed.js';

function createPdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.font('Helvetica').fontSize(12).fillColor('#111111');
    for (const line of lines) pdf.text(line);
    pdf.end();
  });
}

function multipartPdf(buffer: Buffer, type = 'AFFILIATION_FORM') {
  const boundary = `----occi-evidence-${Date.now()}-${buffer.length}`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="synthetic"\r\n\r\ntrue\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="solicitud.pdf"\r\n` +
          'Content-Type: application/pdf\r\n\r\n',
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('ubicación local de evidencia PDF', () => {
  test('interpreta las coordenadas XHTML normalizadas por página', () => {
    const pages = parsePdftotextBoundingBoxes(`
      <doc><page width="600" height="800"><flow><block><line xMin="40" yMin="90" xMax="300" yMax="105">
      <word xMin="100" yMin="90" xMax="160" yMax="105">Jasmin</word>
      <word xMin="165" yMin="90" xMax="205" yMax="105">Lopez</word>
      </line></block></flow></page></doc>`);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].words.length, 2);
    assert.equal(pages[0].words[0].text, 'Jasmin');
    assert.equal(pages[0].width, 600);
  });

  test('ubica un valor real y no inventa recuadro cuando no hay coincidencia', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'occi-evidence-test-'));
    const uploadsDir = path.join(dataDir, 'uploads');
    const caseDir = path.join(uploadsDir, 'case-001');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(caseDir, { recursive: true });
    const pdfPath = path.join(caseDir, 'solicitud.pdf');
    await writeFile(pdfPath, await createPdf([
      'SOLICITUD DE AFILIACION',
      'Nombre completo: Maria Cliente Demo',
      'Nacionalidad: Hondurena',
      'Municipio Ciudad: Tegucigalpa',
    ]));
    try {
      const source = createSeedDatabase().cases.find((item) => item.id === 'case-001');
      assert.ok(source);
      const document = source.documents.find((item) => item.type === 'AFFILIATION_FORM');
      assert.ok(document);
      const afpcCase = {
        ...source,
        documents: source.documents.map((item) => item.id === document.id
          ? { ...item, mimeType: 'application/pdf', storageKey: 'case-001/solicitud.pdf' }
          : item),
      };
      const insight = await applyVerifiedPdfEvidence(
        buildLocalDocumentIntelligence(afpcCase),
        afpcCase,
        uploadsDir,
        new PdfEvidenceLocator(),
      );
      const name = insight.extractedFields.find(
        (field) => field.documentId === document.id && field.field === 'fullName',
      );
      assert.equal(name?.evidenceLocation, 'verified-pdf-text');
      assert.equal(name?.page, 1);
      assert.ok(name?.boundingBox);
      assert.ok(name.boundingBox.x > 0 && name.boundingBox.x < 1);
      assert.ok(name.boundingBox.y > 0 && name.boundingBox.y < 1);
      const contribution = insight.extractedFields.find(
        (field) => field.documentId === document.id && field.field === 'contributionAmount',
      );
      assert.equal(contribution?.evidenceLocation, 'unavailable');
      assert.equal(contribution?.boundingBox, undefined);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test('activa OCR únicamente cuando el PDF no contiene palabras seleccionables', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'occi-evidence-ocr-test-'));
    const sourcePath = path.join(dataDir, 'escaneado.pdf');
    await writeFile(sourcePath, await createPdf([]));
    let ocrCalls = 0;
    const locator = new PdfEvidenceLocator({
      ocrRunner: async (_pdfPath, pages) => {
        ocrCalls += 1;
        assert.deepEqual(pages, [1]);
        return [{
          page: 1,
          width: 1_000,
          height: 1_400,
          words: [
            { text: 'Maria', normalized: 'maria', xMin: 200, yMin: 300, xMax: 270, yMax: 325, line: 0 },
            { text: 'Cliente', normalized: 'cliente', xMin: 275, yMin: 300, xMax: 355, yMax: 325, line: 0 },
            { text: 'Demo', normalized: 'demo', xMin: 360, yMin: 300, xMax: 420, yMax: 325, line: 0 },
          ],
        }];
      },
    });
    const source = createSeedDatabase().cases.find((item) => item.id === 'case-001');
    assert.ok(source);
    const document = source.documents.find((item) => item.type === 'AFFILIATION_FORM');
    assert.ok(document);
    const field = buildLocalDocumentIntelligence(source).extractedFields.find(
      (item) => item.documentId === document.id && item.field === 'fullName',
    );
    assert.ok(field);
    try {
      const first = await locator.locate(sourcePath, [field]);
      const cached = await locator.locate(sourcePath, [field]);
      assert.equal(first.get(field.id)?.page, 1);
      assert.ok(first.get(field.id)?.boundingBox);
      assert.deepEqual(cached, first);
      assert.equal(ocrCalls, 1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test('no activa OCR cuando la capa de texto ya contiene palabras', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'occi-evidence-no-ocr-test-'));
    const sourcePath = path.join(dataDir, 'texto.pdf');
    await writeFile(sourcePath, await createPdf(['Nombre completo: Maria Cliente Demo']));
    let ocrCalls = 0;
    const locator = new PdfEvidenceLocator({
      ocrRunner: async () => {
        ocrCalls += 1;
        return [];
      },
    });
    const source = createSeedDatabase().cases.find((item) => item.id === 'case-001');
    assert.ok(source);
    const document = source.documents.find((item) => item.type === 'AFFILIATION_FORM');
    assert.ok(document);
    const field = buildLocalDocumentIntelligence(source).extractedFields.find(
      (item) => item.documentId === document.id && item.field === 'fullName',
    );
    assert.ok(field);
    try {
      const locations = await locator.locate(sourcePath, [field]);
      assert.ok(locations.get(field.id)?.boundingBox);
      assert.equal(ocrCalls, 0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('API de evidencia PDF verificada', () => {
  let app: FastifyInstance;
  let dataDir: string;

  before(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'occi-evidence-api-'));
    app = await buildApp({
      dataDir,
      geminiConfig: { model: 'gemini-test', configured: false, source: 'none' },
    });
  });

  after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  test('GET y POST ai-insights devuelven coordenadas verificadas del PDF cargado', async () => {
    const pdf = await createPdf([
      'SOLICITUD DE AFILIACION',
      'Nombre completo: Maria Cliente Demo',
      'Nacionalidad: Hondurena',
      'Residencia: Honduras',
      'Municipio Ciudad: Tegucigalpa',
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/cases/case-001/documents',
      ...multipartPdf(pdf),
    });
    assert.equal(upload.statusCode, 201);
    const documentId = upload.json().document.id as string;

    const preview = await app.inject({ method: 'GET', url: '/api/cases/case-001/ai-insights' });
    assert.equal(preview.statusCode, 200);
    const getField = preview.json().extractedFields.find(
      (field: { documentId: string; field: string }) =>
        field.documentId === documentId && field.field === 'fullName',
    );
    assert.equal(getField.evidenceLocation, 'verified-pdf-text');
    assert.ok(getField.boundingBox);

    const persisted = await app.inject({ method: 'POST', url: '/api/cases/case-001/ai-insights' });
    assert.equal(persisted.statusCode, 200);
    const postField = persisted.json().extractedFields.find(
      (field: { documentId: string; field: string }) =>
        field.documentId === documentId && field.field === 'fullName',
    );
    assert.equal(postField.evidenceLocation, 'verified-pdf-text');
    assert.deepEqual(postField.boundingBox, getField.boundingBox);
  });
});
