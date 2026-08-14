import type { AfpcCase } from './types.js';

export function buildCorePayload(afpcCase: AfpcCase) {
  const errors: string[] = [];
  if (!['APROBADO', 'LISTO_CORE', 'ARCHIVADO'].includes(afpcCase.status)) {
    errors.push('El caso aún no tiene una aprobación humana registrada.');
  }
  if (afpcCase.validations.some((item) => item.severity === 'error')) {
    errors.push('Existen validaciones obligatorias pendientes.');
  }

  return {
    caseId: afpcCase.id,
    generatedAt: new Date().toISOString(),
    target: 'CORE_AFPC_DEMO' as const,
    mode: 'simulation' as const,
    payload: {
      demoMasked: true,
      requestReference: afpcCase.reference,
      customer: {
        fullName: afpcCase.client.fullName,
        identificationType: afpcCase.client.idType,
        identification: afpcCase.client.idNumberMasked,
        nationality: afpcCase.client.nationality,
        countryOfResidence: afpcCase.client.residenceCountry,
        city: afpcCase.client.city,
      },
      affiliation: {
        plan: afpcCase.product.plan,
        currency: afpcCase.product.currency,
        contributionAmount: afpcCase.product.contributionAmount,
        frequency: afpcCase.product.frequency,
        paymentMethod: afpcCase.product.paymentMethod,
        sourceOfFunds: afpcCase.product.sourceOfFunds,
      },
      controls: {
        riskLevel: afpcCase.risk.level,
        riskScore: afpcCase.risk.score,
        route: afpcCase.risk.route,
        fatcaPositive: afpcCase.facts.fatcaPositive,
        identityVerified: afpcCase.facts.identityVerified,
        beneficiaryPercentTotal: afpcCase.facts.beneficiaryPercentTotal,
      },
    },
    validation: { valid: errors.length === 0, errors },
  };
}
