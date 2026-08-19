import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { analyzeDocumentCompleteness, inferReceivedDocumentType } from '../src/documentCompleteness.js';

const disabledGemini = { model: 'gemini-test', configured: false, source: 'none' as const };

describe('control de recepción documental', () => {
  test('cuenta tipos únicos y alerta el contrato faltante', async () => {
    const filenames = [
      '1. Solicitud de afilicion Jasmin.pdf',
      '2. Autocertificación FATCA Jasmin.pdf',
      '3. DNI Jasmin.pdf',
      '4. RTN Jasmin.pdf',
      '5. Comprobante de Aporte Jasmin.pdf',
      '5. Comprobante de Aporte Jasmin (1).pdf',
      '6. Constancia De Educación Financiera Jasmin.pdf',
    ];
    const result = await analyzeDocumentCompleteness(
      filenames.map((filename, index) => ({ id: `doc-${index}`, filename, contentType: 'application/pdf', sizeBytes: 100 })),
      disabledGemini,
    );

    assert.equal(result.completenessPercent, 86);
    assert.equal(result.receivedCount, 6);
    assert.equal(result.expectedCount, 7);
    assert.equal(result.missingCount, 1);
    assert.deepEqual(result.items.filter((item) => item.status === 'MISSING').map((item) => item.requirementType), ['CONTRACT']);
  });

  test('reconoce nombres con acentos combinados', () => {
    assert.equal(inferReceivedDocumentType('Autocertificación FATCA.pdf'), 'FATCA');
    assert.equal(inferReceivedDocumentType('Constancia De Educación Financiera.pdf'), 'FINANCIAL_EDUCATION');
  });
});
