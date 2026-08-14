import type { AiExtractedField } from './types';

export interface EvidenceBoxStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

/**
 * Devuelve una caja únicamente cuando la ubicación proviene del texto real
 * del PDF y sus coordenadas son válidas para la página mostrada.
 */
export function verifiedEvidenceBoxStyle(field?: AiExtractedField): EvidenceBoxStyle | null {
  if (field?.evidenceLocation !== 'verified-pdf-text' || !field.boundingBox) return null;

  const rawValues = [
    field.boundingBox.x,
    field.boundingBox.y,
    field.boundingBox.width,
    field.boundingBox.height,
  ];
  if (!rawValues.every(Number.isFinite)) return null;

  const { x, y, width, height } = field.boundingBox;
  const normalizedCoordinates = x >= 0 && y >= 0 && width > 0 && height > 0
    && x <= 1 && y <= 1 && x + width <= 1 && y + height <= 1;
  if (!normalizedCoordinates) return null;

  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}
