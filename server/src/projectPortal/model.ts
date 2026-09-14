import { randomUUID } from 'node:crypto';

export const ROLES = ['ADMIN', 'MACAO', 'AFP', 'CONSULTA'] as const;
export type Role = typeof ROLES[number];
export const STATUSES = ['PENDIENTE', 'EN_DESARROLLO', 'PRUEBAS_MACAO', 'VALIDACION_AFP', 'ACEPTADO'] as const;
export type Status = typeof STATUSES[number];
export interface Member { id: string; name: string; username: string; role: Role; active: boolean; salt?: string; hash?: string }
export interface Task {
  id: string; title: string; description: string; acceptance: string; sprint: number;
  status: Status; assigneeId: string | null; priority: 'ALTA' | 'MEDIA' | 'BAJA';
  kind: 'ENTREGABLE' | 'TAREA' | 'SOLICITUD'; dueDate: string | null;
  blocked: string; dependencies: string[]; evidence: string; archived: boolean;
  version: number; createdAt: string; updatedAt: string;
}
export interface Event { id: string; taskId: string | null; actorId: string; actorName: string; action: string; detail: string; at: string }
export interface Comment { id: string; taskId: string; actorId: string; actorName: string; text: string; at: string }
export interface Project {
  schema: 1; name: string; settingsVersion: number; startDate: string | null; morazanicaPause: boolean; virtualDay?: number;
  tasks: Task[]; members: Member[]; comments: Comment[]; events: Event[];
  sessions: { hash: string; memberId: string; expires: number }[];
}
export class PortalError extends Error { constructor(message: string, public statusCode = 400) { super(message); } }
export const sprintDefinitions = [
  [
    "Alcance y arquitectura APEX",
    "Matriz de reglas, diseño del portal, contrato API y criterios UAT. Banco: confirmar versiones, muestras, servicios y responsables.",
    "Ambos equipos aprueban alcance, contrato de datos, reglas, infraestructura y escenarios de aceptación."
  ],
  [
    "Portal y primer intercambio",
    "Ambiente del banco, acceso al portal, configuración y primer intercambio con APEX. Banco: habilitar base, documentos y Gemini.",
    "Acceso y permisos verificados; APEX envía un expediente de prueba al motor."
  ],
  [
    "Extracción y administración",
    "Clasificación y extracción; pantallas para matrices documentales y reglas. Banco: validar muestras y presentar resultados.",
    "Se contrastan campos y faltantes con documentos de referencia; administradores editan las configuraciones soportadas."
  ],
  [
    "Reglas y publicación",
    "Consistencia, evidencia, versionado, publicación y auditoría desde el portal. Banco: validar reglas y resultados en APEX.",
    "Una regla se prueba y publica; el análisis nuevo la aplica y el anterior conserva su versión."
  ],
  [
    "Integración completa",
    "Recorrido APEX–motor, errores, duplicados, recuperación y reprocesos. IT completa su extremo.",
    "El resultado corresponde a la versión correcta; errores y reintentos no provocan aprobación implícita ni duplicados."
  ],
  [
    "Piloto integrado",
    "Versión candidata con motor, portal administrativo y APEX. Participación de IT y usuarios clave.",
    "Piloto controlado de extremo a extremo; se registran observaciones. No sustituye la aceptación final."
  ],
  [
    "UAT y ajustes",
    "Pruebas integrales, seguridad, rendimiento acordado, correcciones y manuales. Banco: ejecutar UAT.",
    "Usuarios clave validan criterios de aceptación y ambos equipos corrigen sus componentes."
  ],
  [
    "Despliegue y entrega",
    "Correcciones finales, capacitación, despliegue en el banco y transferencia operativa.",
    "AFP recibe versión, documentación y evidencias de operación y recuperación; aceptación contractual separada."
  ]
] as const;
export const demoMembers: Member[] = [
  { id: 'demo-admin', username: 'demo-admin', name: 'Coordinación MACAO · Demo', role: 'ADMIN', active: true },
  { id: 'demo-macao', username: 'demo-macao', name: 'Equipo MACAO · Demo', role: 'MACAO', active: true },
  { id: 'demo-afp', username: 'demo-afp', name: 'Validador AFP · Demo', role: 'AFP', active: true },
  { id: 'demo-viewer', username: 'demo-viewer', name: 'Consulta AFP · Demo', role: 'CONSULTA', active: true },
];
export function seedProject(): Project {
  const now = new Date().toISOString();
  return { schema: 1, name: 'Motor de análisis y portal administrativo', settingsVersion: 1, startDate: null, morazanicaPause: true,
    members: [], comments: [], events: [], sessions: [],
    tasks: sprintDefinitions.map(([title, description, acceptance], i) => ({ id: `entrega-${i + 1}`, title, description, acceptance,
      sprint: i + 1, status: 'PENDIENTE', assigneeId: null, priority: 'MEDIA', kind: 'ENTREGABLE', dueDate: null,
      blocked: '', dependencies: [], evidence: '', archived: false, version: 1, createdAt: now, updatedAt: now })),
  };
}
export function event(p: Project, actor: Member, action: string, detail: string, taskId: string | null = null) {
  p.events.push({ id: randomUUID(), taskId, actorId: actor.id, actorName: actor.name, action, detail, at: new Date().toISOString() });
}
export function text(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new PortalError(`${name}: texto ${required ? 'obligatorio, ' : ''}máximo ${max} caracteres.`);
  return value.trim();
}
export function date(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new PortalError('Fecha inválida.');
  const d = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new PortalError('Fecha inválida.');
  return value;
}
export function evidenceUrl(value: unknown): string {
  const url = text(value, 'Evidencia', 2000);
  if (!url) return '';
  try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
  catch { throw new PortalError('La evidencia debe ser un enlace HTTP o HTTPS sin credenciales.'); }
  return url;
}
export function taskFields(body: Record<string, unknown>, p: Project, current?: Task): Task {
  const source = { ...current, ...body };
  const title = text(source.title, 'Título', 160, true);
  const description = text(source.description ?? '', 'Descripción', 4000);
  const acceptance = text(source.acceptance ?? '', 'Criterio de aceptación', 2000, true);
  if (!Number.isInteger(source.sprint) || Number(source.sprint) < 1 || Number(source.sprint) > 8) throw new PortalError('Sprint inválido.');
  if (!['ALTA', 'MEDIA', 'BAJA'].includes(String(source.priority))) throw new PortalError('Prioridad inválida.');
  if (!['ENTREGABLE', 'TAREA', 'SOLICITUD'].includes(String(source.kind))) throw new PortalError('Tipo inválido.');
  const assigneeId = source.assigneeId || null;
  if (assigneeId !== null && !p.members.some(m => m.id === assigneeId && m.active && m.role !== 'CONSULTA')) throw new PortalError('Responsable inválido o inactivo.');
  const dependencies = source.dependencies ?? [];
  if (!Array.isArray(dependencies) || dependencies.length > 30 || dependencies.some(id => typeof id !== 'string' || id === current?.id || !p.tasks.some(t => t.id === id && !t.archived))) throw new PortalError('Dependencias inválidas.');
  if (current) {
    const reaches = (id: string, visited = new Set<string>()): boolean => {
      if (id === current.id) return true; if (visited.has(id)) return false; visited.add(id);
      return p.tasks.find(t => t.id === id)?.dependencies.some(dep => reaches(dep, visited)) ?? false;
    };
    if (dependencies.some(id => reaches(id))) throw new PortalError('La dependencia crearía un ciclo.');
  }
  const now = new Date().toISOString();
  return { id: current?.id ?? randomUUID(), title, description, acceptance, sprint: Number(source.sprint), status: current?.status ?? 'PENDIENTE',
    assigneeId: assigneeId as string | null, priority: source.priority as Task['priority'], kind: source.kind as Task['kind'],
    dueDate: date(source.dueDate ?? null), blocked: current?.blocked ?? '', dependencies: [...new Set(dependencies)] as string[], evidence: evidenceUrl(source.evidence ?? ''),
    archived: current?.archived ?? false, version: current?.version ?? 1, createdAt: current?.createdAt ?? now, updatedAt: now };
}
