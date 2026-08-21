import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  AFFILIATE_HEADERS,
  BENEFICIARY_HEADERS,
  affiliateRows,
  beneficiaryRows,
  buildFinalizedCasesArchive,
  type FinalizedCaseExportSource,
} from '../src/finalizedCaseExports.js';
import type { DocumentIntelligenceInsight, ExtractedDocumentField } from '../src/types.js';

function field(field: string, value: string | number | boolean): ExtractedDocumentField {
  return {
    id: field,
    documentId: 'doc-1',
    documentType: 'AFFILIATION_FORM',
    field,
    label: field,
    value,
    confidence: 0.98,
    page: 1,
    evidence: `${field}: ${String(value)}`,
    evidenceLocation: 'gemini-pdf-page',
    status: 'EXTRACTED',
    origin: 'gemini-document-extraction',
  };
}

const insight = {
  extractedFields: [
    field('fullName', 'Jasmin Isabel Lopez Giron'),
    field('idType', 'DNI'),
    field('idNumber', '0801-2000-18719'),
    field('monthlyIncome', 10_000),
    field('contributionAmount', 250),
    field('pepDeclared', false),
    field('fatcaPositive', false),
    field('beneficiary1FullName', 'Carlos Alberto Lopez Diaz'),
    field('beneficiary1IdType', 'DNI'),
    field('beneficiary1IdNumber', '0801-2001-12345'),
    field('beneficiary1Type', 'D'),
    field('beneficiary1Percentage', 100),
    field('beneficiary1Relationship', 1),
  ],
} as DocumentIntelligenceInsight;

const source: FinalizedCaseExportSource = {
  code: 'AFPC-20260821-00001',
  senderEmail: 'jasmin@example.test',
  receivedAt: new Date('2026-08-21T14:00:00.000Z'),
  finalizedAt: new Date('2026-08-21T15:00:00.000Z'),
  documentIntelligence: insight,
};

test('mapea afiliados y beneficiarios sin alterar el orden de las plantillas', () => {
  const affiliates = affiliateRows([source]);
  const beneficiaries = beneficiaryRows([source]);
  assert.equal(AFFILIATE_HEADERS.length, 63);
  assert.equal(BENEFICIARY_HEADERS.length, 15);
  assert.equal(affiliates[0].length, AFFILIATE_HEADERS.length);
  assert.equal(beneficiaries[0].length, BENEFICIARY_HEADERS.length);
  assert.equal(affiliates[0][AFFILIATE_HEADERS.indexOf('PRIMER_NOMBRE')], 'Jasmin');
  assert.equal(affiliates[0][AFFILIATE_HEADERS.indexOf('PRIMER_APELLIDO')], 'Lopez');
  assert.equal(beneficiaries[0][BENEFICIARY_HEADERS.indexOf('PRIMER_NOMBRE')], 'Carlos');
  assert.equal(beneficiaries[0][BENEFICIARY_HEADERS.indexOf('PORC_DISTRIBUCION')], 100);
});

test('genera un ZIP con dos libros BIFF8 y las hojas esperadas', async () => {
  const archive = await buildFinalizedCasesArchive([source]);
  const zip = await JSZip.loadAsync(archive);
  assert.deepEqual(Object.keys(zip.files).sort(), ['Archivo_Afiliados.xls', 'Archivo_Beneficiario.xls']);
  for (const filename of Object.keys(zip.files)) {
    const workbook = XLSX.read(await zip.file(filename)!.async('nodebuffer'), { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, ['Roles', 'Hoja1']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Hoja1, { header: 1 });
    assert.ok(rows.length >= 2);
  }
});
