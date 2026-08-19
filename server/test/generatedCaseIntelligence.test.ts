import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGeneratedCaseIntelligence,
  type GeneratedIntelligenceDocument,
} from '../src/generatedCaseIntelligence.js';

const TYPES = [
  ['form', '1. Solicitud de afiliacion.pdf', 'AFFILIATION_FORM'],
  ['identity', '2. DNI.pdf', 'IDENTITY'],
  ['rtn', '3. RTN.pdf', 'RTN'],
  ['receipt', '4. Comprobante de aporte.pdf', 'CONTRIBUTION_RECEIPT'],
  ['education', '5. Educacion financiera.pdf', 'FINANCIAL_EDUCATION'],
  ['fatca', '6. FATCA.pdf', 'FATCA'],
  ['contract', '7. Contrato de afiliacion.pdf', 'CONTRACT'],
] as const;

const documents: GeneratedIntelligenceDocument[] = TYPES.map(([id, filename], index) => ({
  id,
  filename,
  contentType: 'application/pdf',
  checksumSha256: String(index + 1).padStart(64, '0'),
  content: Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF'),
}));

const valuesByType: Record<string, Array<[string, string]>> = {
  AFFILIATION_FORM: [
    ['fullName', 'Jasmin Isabel Lopez Giron'], ['idNumber', '0801-2000-18719'],
    ['nationality', 'Hondurena'], ['residenceCountry', 'Honduras'], ['city', 'Tegucigalpa'],
    ['plan', 'Individual'], ['contributionAmount', 'HNL 250.00'], ['currency', 'HNL'],
    ['sourceOfFunds', 'Remuneracion salarial'], ['monthlyIncome', 'HNL 10000.00'],
    ['educationFinancialYear', '2026'], ['signaturesComplete', 'Si'],
  ],
  IDENTITY: [
    ['fullName', 'Jasmin Isabel Lopez Giron'], ['idNumber', '0801-2000-18719'],
    ['nationality', 'HND'], ['city', 'Tegucigalpa'],
  ],
  RTN: [['fullName', 'LOPEZ GIRON, JASMIN ISABEL'], ['taxId', '08011999123456']],
  CONTRIBUTION_RECEIPT: [
    ['contributionAmount', 'HNL 250.00'], ['currency', 'HNL'], ['sourceOfFunds', 'Remuneracion salarial'],
  ],
  FINANCIAL_EDUCATION: [
    ['fullName', 'Jasmin Isabel Lopez Giron'], ['idNumber', '0801-2000-18719'],
    ['educationFinancialYear', '2026'], ['signaturesComplete', 'Si'],
  ],
  FATCA: [
    ['fullName', 'Jasmin Isabel Lopez Giron'], ['idNumber', '0801-2000-18719'],
    ['residenceCountry', 'Honduras'], ['city', 'Tegucigalpa'], ['fatcaPositive', 'No'],
    ['signaturesComplete', 'Si'],
  ],
  CONTRACT: [
    ['fullName', 'Jasmin Isabel Lopez Giron'], ['idNumber', '0801-2000-18719'],
    ['plan', 'Individual'], ['contributionAmount', 'HNL 250.00'], ['signaturesComplete', 'Si'],
  ],
};

function extraction(identityNumber = '0801-2000-18719') {
  return {
    caseSummary: 'El expediente identifica a la solicitante y contiene los datos económicos del aporte mensual.',
    documents: TYPES.map(([id, , documentType]) => ({
      documentId: id,
      documentType,
      classificationConfidence: 0.98,
      quality: { readability: 0.95, completeness: 0.96, orientation: 'upright' },
      fields: valuesByType[documentType].map(([field, originalValue]) => ({
        field,
        label: field,
        value: id === 'identity' && field === 'idNumber' ? identityNumber : originalValue,
        confidence: 0.97,
        page: 1,
        evidence: `${field}: ${originalValue}`,
        status: 'EXTRACTED',
      })),
    })),
  };
}

test('construye análisis real trazable y mantiene decisión humana', () => {
  const result = buildGeneratedCaseIntelligence('case-1', documents, extraction(), 'gemini-2.5-flash-lite');
  assert.equal(result.insight.analysis.syntheticOnly, false);
  assert.equal(result.insight.analysis.provider, 'gemini');
  assert.equal(result.insight.documents.length, 7);
  assert.ok(result.insight.extractedFields.length > 20);
  assert.equal(result.insight.consistency.find((item) => item.field === 'idNumber')?.verdict, 'MATCH');
  assert.equal(result.insight.sourceOfFunds.alignment, 'CONSISTENT');
  assert.equal(result.risk.level, 'BAJO');
  assert.equal(result.insight.recommendation.decision, 'CONTINUE');
  assert.equal(result.insight.recommendation.humanDecisionRequired, true);
  assert.match(result.insight.documents[0].contentUrl, /generated-cases\/case-1\/documents/);
});

test('una identidad inconsistente genera alerta crítica y ruta de Cumplimiento', () => {
  const result = buildGeneratedCaseIntelligence('case-2', documents, extraction('0801-2000-99999'), 'gemini-2.5-flash-lite');
  assert.equal(result.insight.consistency.find((item) => item.field === 'idNumber')?.verdict, 'MISMATCH');
  assert.ok(result.insight.anomalies.some((item) => item.ruleCode === 'CONSISTENCY_IDNUMBER' && item.severity === 'high'));
  assert.equal(result.risk.route, 'CUMPLIMIENTO');
  assert.equal(result.insight.recommendation.decision, 'SUBSANATE');
});

test('descarta un resumen factual en inglés y conserva la recomendación en español', () => {
  const payload = extraction();
  payload.caseSummary = 'The client submitted documents and a contribution was made.';
  const result = buildGeneratedCaseIntelligence('case-3', documents, payload, 'gemini-2.5-flash-lite');
  assert.doesNotMatch(result.insight.executiveSummary, /\bThe client\b/iu);
  assert.doesNotMatch(result.insight.recommendation.rationale.join(' '), /\binsufficient\b/iu);
  assert.match(result.insight.executiveSummary, /Resultado determinístico/u);
});

test('no confunde ciudadanía estadounidense con condición PEP', () => {
  const payload = extraction();
  const fatca = payload.documents.find((document) => document.documentType === 'FATCA');
  assert.ok(fatca);
  const fatcaIndicator = fatca.fields.find((field) => field.field === 'fatcaPositive');
  assert.ok(fatcaIndicator);
  fatcaIndicator.value = 'Si';
  fatcaIndicator.evidence = 'Es RESIDENTE de los EE.UU. (X)';
  fatca.fields.push({
    field: 'pepDeclared', label: 'Condición PEP', value: 'Si', confidence: 0.99,
    page: 1, evidence: 'Es CIUDADANO O NACIONALIZADO de los EE.UU. (X)', status: 'EXTRACTED',
  });
  const result = buildGeneratedCaseIntelligence('case-4', documents, payload, 'gemini-2.5-flash-lite');
  assert.ok(result.insight.anomalies.some((item) => item.ruleCode === 'FATCA_POSITIVE'));
  assert.ok(!result.insight.anomalies.some((item) => item.ruleCode === 'PEP_DECLARED'));
});
