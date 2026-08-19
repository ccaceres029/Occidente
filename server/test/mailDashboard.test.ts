import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildMailOperationalDashboard, findTrashMailboxPath } from '../src/mail.js';

describe('resumen operativo desde recepción de correo', () => {
  test('consolida solicitudes, casos, documentos y etapas reales', () => {
    const dashboard = buildMailOperationalDashboard({
      incoming_total: 12,
      generated_total: 9,
      document_total: 31,
      pending_generation: 1,
      incomplete: 3,
      ready_for_analysis: 2,
      analyzing: 1,
      decision_pending: 2,
      analysis_error: 1,
      compliance: 2,
    } as never, [
      { date: '2026-08-18', count: 4 } as never,
      { date: '2026-08-19', count: 2 } as never,
    ], [], [], new Date('2026-08-19T12:00:00Z'));

    assert.equal(dashboard.source, 'mail-intake');
    assert.equal(dashboard.metrics.incomingTotal, 12);
    assert.equal(dashboard.metrics.generatedTotal, 9);
    assert.equal(dashboard.metrics.documentTotal, 31);
    assert.equal(dashboard.metrics.inReview, 3);
    assert.equal(dashboard.metrics.reprocessRate, 33.3);
    assert.equal(dashboard.volumeByDay.at(-1)?.count, 2);
    assert.equal(dashboard.byStatus.find((item) => item.status === 'DECISION_PENDING')?.count, 2);
  });
});

describe('movimiento seguro del correo procesado', () => {
  test('usa la carpeta identificada por IMAP como Papelera', () => {
    assert.equal(findTrashMailboxPath([
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: 'INBOX.Trash', specialUse: '\\Trash' },
    ]), 'INBOX.Trash');
  });

  test('no adivina una carpeta cuando el servidor no expone Papelera', () => {
    assert.equal(findTrashMailboxPath([{ path: 'INBOX' }, { path: 'Archivo' }]), undefined);
  });
});
