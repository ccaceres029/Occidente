import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildGeneratedCaseAuditTrail } from '../src/generatedCaseAudit.js';

describe('trazabilidad de casos generados', () => {
  test('ordena el flujo completo y conserva responsables humanos, externos y automáticos', () => {
    const events = buildGeneratedCaseAuditTrail({
      id: 'case-1',
      code: 'AFPC-20260821-00001',
      subject: 'Solicitud de afiliación',
      senderName: 'Cliente Demo',
      senderEmail: 'cliente@example.com',
      receivedAt: '2026-08-21T13:00:00.000Z',
      createdAt: '2026-08-21T13:00:02.000Z',
      sourceMovedAt: '2026-08-21T13:00:08.000Z',
      documents: [{
        id: 'document-1',
        filename: 'identidad.pdf',
        sizeBytes: 2_048,
        createdAt: '2026-08-21T13:00:04.000Z',
      }],
      documentAnalysis: {
        status: 'COMPLETE',
        provider: 'gemini',
        model: 'gemini-test',
        completenessPercent: 100,
        expectedCount: 1,
        receivedCount: 1,
        missingCount: 0,
        analyzedAt: '2026-08-21T13:00:10.000Z',
      },
      intelligence: {
        status: 'COMPLETE',
        model: 'gemini-test',
        analyzedAt: '2026-08-21T13:00:15.000Z',
        riskLevel: 'BAJO',
        riskScore: 18,
      },
      mailEvents: [{
        id: 'mail-1',
        direction: 'OUTBOUND',
        eventType: 'MISSING_DOCUMENT_REQUEST',
        subject: 'Documentos pendientes',
        counterpartyEmail: 'cliente@example.com',
        status: 'SENT',
        createdAt: '2026-08-21T13:00:05.000Z',
        sentAt: '2026-08-21T13:00:06.000Z',
        updatedAt: '2026-08-21T13:00:06.000Z',
      }],
      finalizedAt: '2026-08-21T13:00:20.000Z',
      finalizedBy: 'Administrador Occidente',
    });

    assert.deepEqual(events.map((event) => event.type), [
      'EMAIL_RECEIVED',
      'CASE_CREATED',
      'DOCUMENT_STORED',
      'MISSING_DOCUMENT_REQUEST',
      'SOURCE_EMAIL_MOVED',
      'DOCUMENT_ANALYSIS',
      'INTELLIGENCE_ANALYSIS',
      'CASE_FINALIZED',
    ]);
    assert.equal(events[0].actor, 'Cliente Demo');
    assert.equal(events.at(-1)?.actor, 'Administrador Occidente');
    assert.equal(events.at(-1)?.actorType, 'PERSON');
    assert.match(events.find((event) => event.type === 'DOCUMENT_STORED')?.detail || '', /2\.0 KB/u);
  });
});
