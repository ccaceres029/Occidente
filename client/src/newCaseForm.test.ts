import { describe, expect, it } from 'vitest';
import { createBlankCaseForm } from './newCaseForm';

describe('formulario de nueva afiliación', () => {
  it('inicia sin datos predefinidos', () => {
    const form = createBlankCaseForm();
    expect(form).toEqual({
      agency: '',
      advisor: '',
      client: {
        fullName: '',
        idType: '',
        idNumber: '',
        nationality: '',
        residenceCountry: '',
        city: '',
      },
      product: {
        plan: '',
        currency: '',
        contributionAmount: 0,
        frequency: '',
        paymentMethod: '',
        sourceOfFunds: '',
      },
    });
  });

  it('entrega una instancia nueva para evitar reutilizar datos modificados', () => {
    const first = createBlankCaseForm();
    first.client.fullName = 'Dato temporal';
    expect(createBlankCaseForm().client.fullName).toBe('');
  });
});
