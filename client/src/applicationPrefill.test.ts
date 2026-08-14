import { describe, expect, it } from 'vitest';
import {
  applyApplicationPrefill,
  defaultApplicationPrefillSelection,
  normalizeConfidence,
  selectApplicationPrefillPatch,
} from './applicationPrefill';
import type { ApplicationPrefillField, CreateCaseInput } from './types';

const blank: CreateCaseInput = {
  agency: '',
  advisor: '',
  client: { fullName: '', idType: '', idNumber: '', nationality: '', residenceCountry: '', city: '' },
  product: { plan: '', currency: '', contributionAmount: 0, frequency: '', paymentMethod: '', sourceOfFunds: '' },
};

const fields: ApplicationPrefillField[] = [
  { path: 'client.fullName', label: 'Nombre', value: 'Cliente Sintético', confidence: .98, page: 1, evidence: 'Nombre: Cliente Sintético', status: 'extraído' },
  { path: 'client.idNumber', label: 'Identificación', value: '0000-0000-00000', confidence: .96, page: 1, evidence: 'DNI: 0000-0000-00000', status: 'extraído' },
  { path: 'product.sourceOfFunds', label: 'Procedencia', value: 'Ingresos por salario', confidence: .72, page: 2, evidence: 'Procedencia: salario', status: 'revisar' },
  { path: 'unmapped.note', label: 'Nota', value: 'Texto', confidence: .99, page: 2, evidence: 'Nota: Texto', status: 'extraído' },
];

describe('prellenado de solicitud desde PDF', () => {
  it('preselecciona solo campos compatibles, no críticos y con confianza suficiente', () => {
    expect([...defaultApplicationPrefillSelection(fields)]).toEqual(['client.fullName']);
  });

  it('construye un parche únicamente con los campos confirmados', () => {
    const selected = new Set(['client.fullName', 'product.sourceOfFunds']);
    expect(selectApplicationPrefillPatch({
      client: { fullName: 'Cliente Sintético', idNumber: '0000-0000-00000' },
      product: { sourceOfFunds: 'Ingresos por salario', contributionAmount: 1_250 },
      scenario: 'estándar',
    }, selected)).toEqual({
      client: { fullName: 'Cliente Sintético' },
      product: { sourceOfFunds: 'Ingresos por salario' },
    });
  });

  it('aplica sobre una plantilla vacía y normaliza los catálogos visibles', () => {
    const result = applyApplicationPrefill(blank, {
      agency: 'Agencia Centro Demo',
      client: { fullName: 'Cliente Sintético', idType: 'NATIONAL_ID' },
      product: { sourceOfFunds: 'Ingresos por salario', contributionAmount: 1_250, currency: 'hnl' },
      scenario: 'estándar',
    });
    expect(result.agency).toBe('Agencia Centro · Demostración');
    expect(result.client).toEqual({
      fullName: 'Cliente Sintético',
      idType: 'DNI',
      idNumber: '',
      nationality: '',
      residenceCountry: '',
      city: '',
    });
    expect(result.product.sourceOfFunds).toBe('Remuneración salarial');
    expect(result.product.currency).toBe('HNL');
    expect(result.product.contributionAmount).toBe(1_250);
    expect(result.scenario).toBe('standard');
  });

  it('normaliza confianza tanto en escala decimal como porcentual', () => {
    expect(normalizeConfidence(.875)).toBe(88);
    expect(normalizeConfidence(72)).toBe(72);
    expect(normalizeConfidence(Number.NaN)).toBe(0);
  });
});
