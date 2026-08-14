import { describe, expect, it } from 'vitest';
import type { CaseDetail } from './types';
import { buildFallbackInsights, buildSpanishInsightsExport, getConsistencyStats, toConfidencePercent } from './documentIntelligence';

const demoCase = {
  id: 'case-demo', reference: 'AFP-DEMO-001', status: 'EN_REVISION', statusLabel: 'En revisión', currentStage: 'ANALISIS', agency: 'Agencia Demo', advisor: 'Asesor Demo', assignee: 'Analista Demo', createdAt: '2026-08-11T10:00:00Z', updatedAt: '2026-08-11T10:00:00Z',
  client: { fullName: 'Cliente Sintético', idType: 'DNI', idNumberMasked: '0000-****-0000' },
  product: { plan: 'Plan Individual', currency: 'HNL', contributionAmount: 850, frequency: 'Mensual', paymentMethod: 'Débito', sourceOfFunds: 'Salario' },
  risk: { level: 'BAJO', score: 20, route: 'REVISION_ESTANDAR', reasons: [] },
  sla: { receivedAt: '2026-08-11T10:00:00Z', dueAt: '2026-08-12T10:00:00Z', ageHours: 2, breached: false },
  progress: 75,
  documents: [{ id: 'doc-id', name: 'Identidad sintética.pdf', type: 'IDENTITY', status: 'VALID', synthetic: true, uploadedAt: '2026-08-11T10:00:00Z' }],
  validations: [{ id: 'rule-1', code: 'EDUCATION_YEAR_REQUIRED', severity: 'error', title: 'Año pendiente', message: 'No se identificó el año.', resolved: false }],
} as CaseDetail;

describe('inteligencia documental local', () => {
  it('mantiene decisión humana y evidencia enmascarada', () => {
    const result = buildFallbackInsights(demoCase);
    expect(result.analysis.provider).toBe('local-fallback');
    expect(result.recommendation.humanDecisionRequired).toBe(true);
    expect(result.extractedFields.find((field) => field.field === 'client.idNumber')?.value).toBe('0000-****-0000');
    expect(result.anomalies).toHaveLength(1);
  });

  it('calcula consistencia y acota la confianza', () => {
    const result = buildFallbackInsights(demoCase);
    expect(getConsistencyStats(result.consistency)).toEqual({ total: 4, matched: 3, review: 1, score: 75 });
    expect(toConfidencePercent(1.4)).toBe(100);
    expect(toConfidencePercent(-.2)).toBe(0);
  });

  it('exporta un informe de negocio sin términos operativos en inglés', () => {
    const report = JSON.stringify(buildSpanishInsightsExport(buildFallbackInsights(demoCase)));
    expect(report).not.toMatch(/\b(?:pipeline|fallback|snapshot|checklist|screening|workflow|review|missing|match|source|funds|compliance|score|high|medium|low|completed|classification|extraction|risk|fullName|idNumber|limitations)\b/i);
    expect(report).toContain('flujoDeAnálisis');
    expect(report).toContain('decisiónHumanaObligatoria');
  });
});
