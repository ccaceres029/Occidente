import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildMissingDocumentsMessage,
  extractCaseCode,
  parsedMailReferences,
} from '../src/caseMailThread.js';

describe('hilo de subsanación documental', () => {
  test('extrae el código AFPC de una respuesta', () => {
    assert.equal(
      extractCaseCode('Re: AFPC-20260818-00003 | Completar: Contrato de afiliación'),
      'AFPC-20260818-00003',
    );
    assert.equal(extractCaseCode('Documentos adicionales'), undefined);
  });

  test('normaliza In-Reply-To y References sin duplicados', () => {
    assert.deepEqual(parsedMailReferences({
      inReplyTo: '<request@example.com>',
      references: ['<original@example.com>', '<request@example.com>'],
    }), ['<request@example.com>', '<original@example.com>']);
  });

  test('construye el asunto y cuerpo para un único faltante', () => {
    const message = buildMissingDocumentsMessage(
      'AFPC-20260818-00003',
      'Carlos Arturo',
      [{ requirementType: 'CONTRACT', label: 'Contrato de afiliación' }],
    );

    assert.equal(message.subject, 'AFPC-20260818-00003 | Completar: Contrato de afiliación');
    assert.match(message.text, /Responda a este mismo correo/u);
    assert.match(message.text, /Contrato de afiliación/u);
    assert.match(message.html, /<strong>AFPC-20260818-00003<\/strong>/u);
  });
});
