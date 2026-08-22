import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DOCUMENT_COMPLETENESS_VERSION } from '../src/documentCompleteness.js';
import { buildMailOperationalDashboard, findTrashMailboxPath, MailService, shouldRunAutomaticAnalysis } from '../src/mail.js';

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

describe('análisis automático por perfil', () => {
  test('solo inicia con la preferencia activa y la matriz al 100%', () => {
    assert.equal(shouldRunAutomaticAnalysis(false, { status: 'COMPLETE', completenessPercent: 100 }), false);
    assert.equal(shouldRunAutomaticAnalysis(true, { status: 'MISSING_DOCUMENTS', completenessPercent: 99 }), false);
    assert.equal(shouldRunAutomaticAnalysis(true, { status: 'COMPLETE', completenessPercent: 100 }), true);
  });

  test('arranca el análisis integral cuando la matriz almacenada llega a 100% y existe una preferencia global activa', async () => {
    const calls: string[] = [];
    const pool = {
      async query(sql: string) {
        calls.push(sql);
        if (sql.includes('FROM generated_case_document_analyses')) {
          return [[{
            status: 'COMPLETE',
            provider: 'local',
            gemini_configured: false,
            completeness_percent: 100,
            expected_count: 10,
            received_count: 10,
            missing_count: 0,
            unclassified_count: 0,
            summary: 'Paquete completo.',
            model: null,
            analysis_version: DOCUMENT_COMPLETENESS_VERSION,
            analyzed_at: new Date('2026-08-22T01:00:00Z'),
          }], []];
        }
        if (sql.includes('FROM generated_case_document_analysis_items')) return [[], []];
        if (sql.includes('auto_analyze_complete_cases=TRUE')) return [[{ id: 'user-admin' }], []];
        throw new Error(`Consulta inesperada: ${sql}`);
      },
    };
    const service = new MailService(pool as never);
    let started = false;
    Object.defineProperty(service, 'ensureGeneratedCaseIntelligence', {
      value: async (id: string, force: boolean) => {
        started = id === 'case-ready' && force === false;
      },
    });

    const analysis = await service.analyzeGeneratedCase('case-ready', false, false);

    assert.equal(analysis?.completenessPercent, 100);
    assert.equal(started, true);
    assert.ok(calls.some((sql) => sql.includes('auto_analyze_complete_cases=TRUE')));
  });
});
