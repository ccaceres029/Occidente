import type { CaseStatus } from './types.js';

export const STATUS_LABELS: Record<CaseStatus, string> = {
  RECIBIDO: 'Recibido',
  EN_REVISION: 'En revisión',
  DEVUELTO: 'Devuelto a agencia',
  CORREGIDO: 'Corrección recibida',
  ESCALADO_CUMPLIMIENTO: 'En Cumplimiento',
  APROBADO: 'Aprobado',
  LISTO_CORE: 'Listo para sistema central',
  ARCHIVADO: 'Archivado',
};

export const STAGE_LABELS: Record<CaseStatus, string> = {
  RECIBIDO: 'Ingreso de solicitud',
  EN_REVISION: 'Control de calidad',
  DEVUELTO: 'Subsanación en agencia',
  CORREGIDO: 'Control de calidad',
  ESCALADO_CUMPLIMIENTO: 'Análisis de Cumplimiento',
  APROBADO: 'Preparación para el sistema central',
  LISTO_CORE: 'Registro en sistema central (simulado)',
  ARCHIVADO: 'Expediente final',
};

export const STATUS_PROGRESS: Record<CaseStatus, number> = {
  RECIBIDO: 10,
  EN_REVISION: 35,
  DEVUELTO: 25,
  CORREGIDO: 45,
  ESCALADO_CUMPLIMIENTO: 60,
  APROBADO: 78,
  LISTO_CORE: 92,
  ARCHIVADO: 100,
};
