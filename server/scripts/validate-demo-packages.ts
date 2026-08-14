import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';

const normalized = (value: string) => value.normalize('NFD').replaceAll(/[\u0300-\u036f]/gu, '').toLowerCase();

const directories = process.argv.slice(2).map((directory) => path.resolve(directory));
if (!directories.length) {
  throw new Error('Indique una o más carpetas de expedientes para validar.');
}

const mimeFor = (name: string) => {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.txt') return 'text/plain';
  return '';
};

const typeFor = (name: string) => {
  const value = normalized(name);
  if (/solicitud|afiliacion/u.test(value)) return 'AFFILIATION_FORM';
  if (/identidad|\bdni\b/u.test(value)) return 'IDENTITY';
  if (/\brtn\b/u.test(value)) return 'RTN';
  if (/comprobante|deposito/u.test(value)) return 'CONTRIBUTION_RECEIPT';
  if (/educacion financiera|constancia.*financiera/u.test(value)) return 'FINANCIAL_EDUCATION';
  if (/fatca|autocertificacion/u.test(value)) return 'FATCA';
  if (/contrato/u.test(value)) return 'CONTRACT';
  if (/procedencia.*fondos|fuente.*fondos/u.test(value)) return 'SOURCE_OF_FUNDS';
  if (/lexis|cautela|lista|busqueda|consulta/u.test(value)) return 'SCREENING';
  if (/correo|email/u.test(value)) return 'EMAIL_CHECKLIST';
  return 'OTHER';
};

const multipart = (name: string, mimeType: string, type: string, buffer: Buffer) => {
  const boundary = `----occi-package-${Date.now()}-${buffer.length}`;
  const before = [
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="synthetic"\r\n\r\ntrue\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name.replaceAll('"', '_')}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ].join('');
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(before), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  };
};

const temporaryData = await mkdtemp(path.join(tmpdir(), 'occi-package-validation-'));
const app = await buildApp({
  dataDir: temporaryData,
  geminiConfig: { model: 'validación-local', configured: false, source: 'none' },
});

try {
  const results = [];
  for (const [index, directory] of directories.entries()) {
    const label = `Paquete ${index + 1}`;
    const directoryEntries = await import('node:fs/promises').then(({ readdir }) => readdir(directory));
    const filenames = directoryEntries.filter((name) => name !== '.DS_Store' && mimeFor(name));
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      payload: {
        agency: 'Agencia de validación',
        advisor: 'Asesor de demostración',
        scenario: 'uploaded',
        client: {
          fullName: `Cliente autorizado ${index + 1}`,
          idType: 'DNI',
          idNumber: `000000000000${index + 1}`,
          nationality: 'Hondureña',
          residenceCountry: 'Honduras',
          city: 'Ciudad de prueba',
        },
        product: {
          plan: 'Plan Individual de Pensiones',
          currency: 'HNL',
          contributionAmount: 500,
          frequency: 'Mensual',
          paymentMethod: 'Débito a cuenta',
          sourceOfFunds: 'Remuneración salarial',
        },
      },
    });
    assert.equal(created.statusCode, 201);
    const caseId = created.json().id as string;
    let applicationDocumentId = '';
    for (const filename of filenames) {
      const mimeType = mimeFor(filename);
      const documentType = typeFor(filename);
      const file = await readFile(path.join(directory, filename));
      const form = multipart(filename, mimeType, documentType, file);
      const uploaded = await app.inject({
        method: 'POST',
        url: `/api/cases/${caseId}/documents`,
        headers: form.headers,
        payload: form.payload,
      });
      assert.equal(uploaded.statusCode, 201, `${label}: archivo ${filenames.indexOf(filename) + 1}`);
      if (documentType === 'AFFILIATION_FORM' && !applicationDocumentId) {
        applicationDocumentId = uploaded.json().document.id;
      }
    }
    assert.ok(applicationDocumentId, `${label}: solicitud no identificada`);
    const preview = await app.inject({
      method: 'GET',
      url: `/api/cases/${caseId}/documents/${applicationDocumentId}/preview?page=1`,
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.rawPayload.subarray(1, 4).toString('ascii'), 'PNG');
    const insights = await app.inject({ method: 'POST', url: `/api/cases/${caseId}/ai-insights` });
    assert.equal(insights.statusCode, 200);
    results.push({
      paquete: label,
      archivos: filenames.length,
      tipos: [...new Set(filenames.map(typeFor))].sort(),
      vistaPreviaSolicitud: 'correcta',
      documentosAnalizados: insights.json().metrics.documentsProcessed,
      alertas: insights.json().metrics.anomaliesDetected,
    });
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await app.close();
  await rm(temporaryData, { recursive: true, force: true });
}
