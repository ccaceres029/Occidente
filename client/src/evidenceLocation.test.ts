import { describe, expect, it } from 'vitest';
import { verifiedEvidenceBoxStyle } from './evidenceLocation';
import type { AiExtractedField } from './types';

const field = (overrides: Partial<AiExtractedField> = {}): AiExtractedField => ({
  id: 'campo-1',
  documentId: 'documento-1',
  documentType: 'AFFILIATION_FORM',
  field: 'client.fullName',
  label: 'Nombre completo',
  value: 'Cliente de prueba',
  confidence: .98,
  page: 1,
  evidence: 'Texto localizado en el PDF.',
  evidenceLocation: 'verified-pdf-text',
  boundingBox: { x: .12, y: .24, width: .3, height: .04 },
  status: 'CONFIRMED',
  ...overrides,
});

describe('ubicación de evidencia en PDF', () => {
  it('dibuja porcentajes cuando la ubicación está verificada', () => {
    expect(verifiedEvidenceBoxStyle(field())).toEqual({
      left: '12%',
      top: '24%',
      width: '30%',
      height: '4%',
    });
  });

  it('no dibuja ubicaciones inferidas, ausentes o inválidas', () => {
    expect(verifiedEvidenceBoxStyle(field({ evidenceLocation: 'unavailable' }))).toBeNull();
    expect(verifiedEvidenceBoxStyle(field({ boundingBox: undefined }))).toBeNull();
    expect(verifiedEvidenceBoxStyle(field({ boundingBox: { x: .1, y: .2, width: 0, height: .05 } }))).toBeNull();
  });

  it('rechaza coordenadas fuera del área normalizada de la página', () => {
    expect(verifiedEvidenceBoxStyle(field({ boundingBox: { x: 1.1, y: .2, width: .1, height: .05 } }))).toBeNull();
    expect(verifiedEvidenceBoxStyle(field({ boundingBox: { x: .92, y: .96, width: .2, height: .15 } }))).toBeNull();
    expect(verifiedEvidenceBoxStyle(field({ boundingBox: { x: 12, y: 24, width: 30, height: 4 } }))).toBeNull();
  });
});
