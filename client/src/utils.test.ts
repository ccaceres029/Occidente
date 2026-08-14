import { describe, expect, it } from 'vitest';
import {
  canPerformCaseAction,
  documentTypeLabel,
  formatEvidenceValue,
  identityTypeLabel,
  payloadForDisplay,
  riskRouteLabel,
  riskTone,
  ruleCodeLabel,
  spanishDynamicText,
  stateLabel,
  statusTone,
  titleFromStatus,
} from './utils';

describe('presentación de estados del expediente', () => {
  it('normaliza los estados internos del API', () => {
    expect(titleFromStatus('RECIBIDO')).toBe('Recibido');
    expect(titleFromStatus('LISTO_CORE')).toBe('Listo para sistema central');
    expect(titleFromStatus('ESCALADO_CUMPLIMIENTO')).toBe('En Cumplimiento');
    expect(statusTone('CUMPLIMIENTO')).toBe('warning');
    expect(statusTone('APROBADO')).toBe('success');
  });

  it('muestra el nivel de riesgo con un tono consistente', () => {
    expect(riskTone('Alto')).toBe('danger');
    expect(riskTone('Medio')).toBe('warning');
    expect(riskTone('Bajo')).toBe('success');
  });

  it('protege decisiones reservadas a Cumplimiento', () => {
    expect(canPerformCaseAction('ESCALADO_CUMPLIMIENTO', ['approve'], 'approve')).toBe(false);
    expect(canPerformCaseAction('EN_REVISION', ['approve'], 'approve')).toBe(true);
    expect(canPerformCaseAction('ESCALADO_CUMPLIMIENTO', ['return'], 'return')).toBe(true);
  });

  it('presenta códigos técnicos con etiquetas españolas', () => {
    expect(documentTypeLabel('SOURCE_OF_FUNDS')).toBe('Respaldo de procedencia de fondos');
    expect(stateLabel('WARNING')).toBe('Con alerta');
    expect(riskRouteLabel('REVISION_ESTANDAR')).toBe('Revisión estándar');
    expect(ruleCodeLabel('ADDRESS_MISMATCH')).toBe('Diferencia de domicilio');
    expect(formatEvidenceValue(false)).toBe('No');
    expect(identityTypeLabel('RESIDENCE_CARD')).toBe('Carné de residencia');
    expect(spanishDynamicText('Procedencia: consistent · SALARY')).toBe('Procedencia: coherente · Remuneración salarial');
  });

  it('crea una vista española del paquete de integración', () => {
    expect(payloadForDisplay({ demoMasked: true, controls: { riskLevel: 'BAJO', route: 'REVISION_ESTANDAR' } })).toEqual({
      datosEnmascaradosDeDemostración: 'Sí',
      controles: { nivelDeRiesgo: 'BAJO', ruta: 'Revisión estándar' },
    });
  });

  it('localiza también la exportación de inteligencia documental', () => {
    expect(payloadForDisplay({
      analysis: { dataOrigin: 'synthetic-canonical-snapshot', cached: true },
      pipeline: [{ status: 'COMPLETED', itemsProcessed: 10 }],
      recommendation: { decision: 'CONTINUE_STANDARD_REVIEW', humanDecisionRequired: true },
    })).toEqual({
      análisis: { origenDeDatos: 'instantánea canónica sintética', resultadoAlmacenado: 'Sí' },
      flujoDeAnálisis: [{ estado: 'Completado', elementosProcesados: 10 }],
      recomendación: { decisión: 'Continuar revisión estándar', decisiónHumanaObligatoria: 'Sí' },
    });
  });
});
