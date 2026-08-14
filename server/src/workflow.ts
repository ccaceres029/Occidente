import { STAGE_LABELS, STATUS_LABELS, STATUS_PROGRESS } from './labels.js';
import { allowedActions, evaluateCaseRules } from './rules.js';
import type { AfpcCase, CaseStatus, WorkflowAction } from './types.js';

const TRANSITIONS: Record<WorkflowAction, { status: CaseStatus; label: string }> = {
  return: { status: 'DEVUELTO', label: 'Expediente devuelto a la agencia' },
  correct: { status: 'CORREGIDO', label: 'Corrección recibida desde la agencia' },
  escalate: {
    status: 'ESCALADO_CUMPLIMIENTO',
    label: 'Expediente escalado a Cumplimiento',
  },
  approve: { status: 'APROBADO', label: 'Expediente aprobado por decisión humana' },
  'ready-core': { status: 'LISTO_CORE', label: 'Expediente preparado para el sistema central simulado' },
  archive: { status: 'ARCHIVADO', label: 'Expediente archivado' },
};

const ALIASES: Record<string, WorkflowAction> = {
  return: 'return',
  devolver: 'return',
  correct: 'correct',
  corregir: 'correct',
  escalate: 'escalate',
  escalar: 'escalate',
  approve: 'approve',
  aprobar: 'approve',
  'ready-core': 'ready-core',
  listo_core: 'ready-core',
  'listo-core': 'ready-core',
  archive: 'archive',
  archivar: 'archive',
};

export class WorkflowError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'WorkflowError';
    this.statusCode = statusCode;
  }
}

export function normalizeAction(value: unknown): WorkflowAction {
  if (typeof value !== 'string') throw new WorkflowError('La acción es obligatoria.', 400);
  const normalized = ALIASES[value.trim().toLowerCase()];
  if (!normalized) throw new WorkflowError(`La acción "${value}" no está soportada.`, 400);
  return normalized;
}

export function transitionCase(
  source: AfpcCase,
  action: WorkflowAction,
  context: { role?: string; note?: string } = {},
): { afpcCase: AfpcCase; label: string } {
  const permitted = allowedActions(source);
  if (!permitted.includes(action)) {
    throw new WorkflowError(
      `La acción ${action} no está permitida para un caso en estado ${source.statusLabel}.`,
    );
  }

  if (action === 'approve') {
    const errors = source.validations.filter((item) => item.severity === 'error');
    if (errors.length > 0) {
      throw new WorkflowError('El expediente tiene validaciones obligatorias pendientes.');
    }
    if (source.risk.route === 'CUMPLIMIENTO' && source.status !== 'ESCALADO_CUMPLIMIENTO') {
      throw new WorkflowError('El expediente debe pasar por Cumplimiento antes de aprobarse.');
    }
    if (source.status === 'ESCALADO_CUMPLIMIENTO') {
      const role = context.role?.trim().toUpperCase().replaceAll(/[^A-Z]/gu, '_');
      if (!['CUMPLIMIENTO', 'COMPLIANCE'].includes(role ?? '')) {
        throw new WorkflowError(
          'Solo un usuario con rol CUMPLIMIENTO puede aprobar un caso escalado.',
          403,
        );
      }
      if (!context.note?.trim()) {
        throw new WorkflowError(
          'La aprobación de Cumplimiento requiere una justificación explícita.',
          400,
        );
      }
    }
  }

  const transition = TRANSITIONS[action];
  const updated: AfpcCase = {
    ...source,
    status: transition.status,
    statusLabel: STATUS_LABELS[transition.status],
    currentStage: STAGE_LABELS[transition.status],
    progress: STATUS_PROGRESS[transition.status],
    updatedAt: new Date().toISOString(),
    documentIntelligence: undefined,
  };
  const evaluation = evaluateCaseRules(updated);
  updated.validations = evaluation.validations;
  updated.risk = evaluation.risk;
  updated.progress = Math.max(updated.progress, evaluation.progress);
  return { afpcCase: updated, label: transition.label };
}
