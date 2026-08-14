import type { CreateCaseInput } from './types';

export const createBlankCaseForm = (): CreateCaseInput => ({
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
