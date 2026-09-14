import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from './store.js';
import { proposal } from './proposal.js';
import { demoMembers, event, PortalError, ROLES, STATUSES, sprintDefinitions, taskFields, text, date, type Member, type Project, type Role, type Status, type Task } from './model.js';

const safeMember = ({ salt: _salt, hash: _hash, ...m }: Member) => m;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordFields(password: unknown) {
  const value = text(password, 'Contraseña', 200, true);
  if (value.length < 12) throw new PortalError('Usa una contraseña de al menos 12 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(value, salt, 64).toString('hex') };
}
function body(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new PortalError('Cuerpo JSON inválido.');
  return request.body as Record<string, unknown>;
}
export async function buildProjectPortal(options: { store: ProjectStore; demo?: boolean; staticDir: string; origin: string; secureCookie?: boolean; bootstrap?: { username: string; name: string; password: string } }) {
  const { store, demo = false, staticDir, origin } = options;
  await store.initialize();
  if (demo) await store.mutate(p => { p.members = structuredClone(demoMembers); p.sessions = []; });
  if (!demo && options.bootstrap) {
    const bootstrap = options.bootstrap;
    await store.mutate(p => {
      if (p.members.length) return;
      p.members.push({ id: randomUUID(), username: text(bootstrap.username, 'Usuario', 100, true).toLowerCase(), name: text(bootstrap.name, 'Nombre', 120, true), role: 'ADMIN', active: true, ...passwordFields(bootstrap.password) });
    });
  }
  const app = Fastify({ bodyLimit: 65536, logger: false, trustProxy: ['127.0.0.1', '::1'] });
  await app.register(cookie);
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    reply.code(status).send({ message: status >= 500 ? 'No se pudo guardar la operación. Intenta nuevamente.' : (error as Error).message });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers['x-portal-request'] !== '1' || (request.headers.origin && request.headers.origin !== origin)) throw new PortalError('Origen de solicitud no autorizado.', 403);
    }
  });
  const actor = async (request: FastifyRequest): Promise<Member> => {
    const p = await store.read();
    if (demo) {
      const id = request.headers['x-demo-user'] ?? 'demo-admin';
      const m = p.members.find(m => m.id === id && m.active);
      if (!m) throw new PortalError('Usuario de demostración inválido.', 401);
      return m;
    }
    const token = request.cookies.macao_project_session;
    const session = token ? p.sessions.find(s => s.hash === digest(token) && s.expires > Date.now()) : undefined;
    const m = p.members.find(m => m.id === session?.memberId && m.active);
    if (!m) throw new PortalError('Inicia sesión para continuar.', 401);
    return m;
  };
  // Recheck access inside the transaction so deactivation takes effect on pending writes.
  const permit = (p: Project, user: Member, roles: Role[]) => {
    const current = p.members.find(m => m.id === user.id && m.active);
    if (!current || !roles.includes(current.role)) throw new PortalError('Tu perfil no permite esta acción.', 403);
    return current;
  };
  const getTask = (p: Project, id: string, version: unknown): Task => {
    const task = p.tasks.find(t => t.id === id && !t.archived);
    if (!task) throw new PortalError('Tarea no encontrada.', 404);
    if (task.version !== version) throw new PortalError('Otra persona actualizó la tarea. Recarga el detalle antes de guardar.', 409);
    return task;
  };
  app.get('/api/portal/session', async request => {
    try { return { user: safeMember(await actor(request)), demo, version: '0.2.0' }; }
    catch { return { user: null, demo, version: '0.2.0' }; }
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/portal/login', async (request, reply) => {
    if (demo) throw new PortalError('En modo local usa el selector de perfil.');
    const now = Date.now();
    for (const [ip, v] of attempts) if (v.until < now) attempts.delete(ip);
    const tries = attempts.get(request.ip) ?? { count: 0, until: now + 15 * 60_000 };
    tries.count++; attempts.set(request.ip, tries);
    if (tries.count > 10 || attempts.size > 10000) throw new PortalError('Demasiados intentos. Espera quince minutos.', 429);
    const b = body(request), username = text(b.username, 'Usuario', 100, true).toLowerCase(), password = text(b.password, 'Contraseña', 200, true);
    const p = await store.read(), member = p.members.find(m => m.username === username && m.active);
    const supplied = scryptSync(password, member?.salt ?? 'unknown-user', 64);
    if (!member?.hash || !timingSafeEqual(supplied, Buffer.from(member.hash, 'hex'))) throw new PortalError('Credenciales incorrectas.', 401);
    const token = randomBytes(32).toString('hex');
    await store.mutate(p => {
      permit(p, member, [...ROLES]);
      p.sessions = p.sessions.filter(s => s.expires > now).slice(-999);
      p.sessions.push({ hash: digest(token), memberId: member.id, expires: now + 8 * 3600_000 });
    });
    attempts.delete(request.ip);
    reply.setCookie('macao_project_session', token, { httpOnly: true, sameSite: 'strict', secure: options.secureCookie ?? true, path: '/', maxAge: 8 * 3600 });
    return { user: safeMember(member) };
  });
  app.post('/api/portal/logout', async (request, reply) => {
    const token = request.cookies.macao_project_session;
    if (token) await store.mutate(p => { p.sessions = p.sessions.filter(s => s.hash !== digest(token)); });
    reply.clearCookie('macao_project_session', { path: '/' }); return { ok: true };
  });
  app.get('/api/portal/project', async request => {
    const user = await actor(request), p = await store.read();
    return { project: { name: p.name, startDate: p.startDate, morazanicaPause: p.morazanicaPause, virtualDay: p.virtualDay ?? 2, settingsVersion: p.settingsVersion },
      tasks: p.tasks, members: p.members.map(safeMember), comments: p.comments, events: p.events.slice(-500).reverse(),
      sprints: sprintDefinitions, proposal, user: safeMember(user), demo };
  });
  app.post('/api/portal/tasks', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN', 'MACAO']);
      if (p.tasks.length >= 1000) throw new PortalError('Este proyecto alcanzó el límite de 1000 tareas.');
      const task = taskFields(b, p); p.tasks.push(task); event(p, user, 'Tarea creada', task.title, task.id); return task;
    });
  });
  app.patch<{ Params: { id: string } }>('/api/portal/tasks/:id', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN', 'MACAO']); const t = getTask(p, request.params.id, b.version);
      if (t.status === 'ACEPTADO') throw new PortalError('Reabre la tarea antes de modificar una entrega aceptada.', 409);
      if (t.kind === 'SOLICITUD' && b.kind && b.kind !== 'SOLICITUD' && user.role !== 'ADMIN') throw new PortalError('Coordinación debe autorizar la incorporación de solicitudes al alcance.', 403);
      const next = taskFields(b, p, t);
      const changes = Object.keys(next).filter(k => !['version', 'updatedAt'].includes(k) && JSON.stringify(t[k as keyof Task]) !== JSON.stringify(next[k as keyof Task])).map(k => `${k}: ${JSON.stringify(t[k as keyof Task])} → ${JSON.stringify(next[k as keyof Task])}`).join('; ');
      next.version++; Object.assign(t, next);
      event(p, user, 'Tarea actualizada', changes || 'Sin cambios en campos de trabajo.', t.id);
      return t;
    });
  });
  app.post<{ Params: { id: string } }>('/api/portal/tasks/:id/status', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      const member = permit(p, user, ['ADMIN', 'MACAO', 'AFP']); const t = getTask(p, request.params.id, b.version);
      if (!STATUSES.includes(b.status as Status)) throw new PortalError('Estado inválido.');
      const status = b.status as Status, note = text(b.note ?? '', 'Observación', 2000);
      if (status === t.status) throw new PortalError('La tarea ya tiene ese estado.');
      const from = STATUSES.indexOf(t.status), to = STATUSES.indexOf(status);
      if (member.role === 'AFP' && !(t.status === 'VALIDACION_AFP' && ['ACEPTADO', 'PRUEBAS_MACAO'].includes(status))) throw new PortalError('AFP puede aceptar o devolver tareas que estén en validación.', 403);
      if (status === 'ACEPTADO') {
        if (!['ADMIN', 'AFP'].includes(member.role)) throw new PortalError('Solo AFP o coordinación puede aceptar entregas.', 403);
        if (t.status !== 'VALIDACION_AFP' || t.blocked || !t.evidence || !note || t.kind === 'SOLICITUD') throw new PortalError('Para aceptar: tarea en validación, sin bloqueo, evidencia y observación. Las solicitudes deben aprobarse e incorporarse al alcance primero.');
        if (t.dependencies.some(id => { const dep = p.tasks.find(x => x.id === id); return !dep || dep.archived || dep.status !== 'ACEPTADO'; })) throw new PortalError('Hay dependencias pendientes de aceptación.');
      } else if (t.status === 'ACEPTADO') {
        if (member.role !== 'ADMIN' || status !== 'PRUEBAS_MACAO' || !note) throw new PortalError('Solo coordinación puede reabrir una tarea aceptada hacia pruebas, con una razón.', 403);
        if (p.tasks.some(x => !x.archived && x.status === 'ACEPTADO' && x.dependencies.includes(t.id))) throw new PortalError('Reabre primero las entregas aceptadas que dependen de esta tarea.');
      } else {
        if (to > from + 1) throw new PortalError('Avanza una etapa a la vez.');
        if (to < from && !note) throw new PortalError('Describe la razón de la devolución.');
        if (to > from && t.blocked) throw new PortalError('Resuelve el bloqueo antes de avanzar.');
        if (status === 'VALIDACION_AFP' && (!t.evidence || !t.assigneeId)) throw new PortalError('Asigna responsable y evidencia antes de enviar a AFP.');
      }
      const previous = t.status; t.status = status; t.version++; t.updatedAt = new Date().toISOString();
      event(p, user, 'Estado actualizado', `${previous} → ${status}${note ? ': ' + note : ''}${status === 'ACEPTADO' ? ` · Evidencia: ${t.evidence} · Criterio: ${t.acceptance} · Versión: ${t.version}` : ''}`, t.id); return t;
    });
  });
  app.post<{ Params: { id: string } }>('/api/portal/tasks/:id/block', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN', 'MACAO', 'AFP']); const t = getTask(p, request.params.id, b.version);
      if (t.status === 'ACEPTADO') throw new PortalError('La tarea aceptada debe reabrirse antes de bloquear.');
      const reason = text(b.reason, 'Razón', 2000); if (!reason && !t.blocked) throw new PortalError('No existe bloqueo que resolver.');
      event(p, user, reason ? 'Bloqueo registrado' : 'Bloqueo resuelto', reason || t.blocked, t.id);
      t.blocked = reason; t.version++; t.updatedAt = new Date().toISOString(); return t;
    });
  });
  app.post<{ Params: { id: string } }>('/api/portal/tasks/:id/comments', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN', 'MACAO', 'AFP']);
      if (!p.tasks.some(t => t.id === request.params.id && !t.archived)) throw new PortalError('Tarea no encontrada.', 404);
      if (p.comments.length >= 10000) throw new PortalError('Límite de comentarios alcanzado.');
      const comment = { id: randomUUID(), taskId: request.params.id, actorId: user.id, actorName: user.name, text: text(b.text, 'Comentario', 4000, true), at: new Date().toISOString() };
      p.comments.push(comment); event(p, user, 'Comentario', comment.text, request.params.id); return comment;
    });
  });
  app.post<{ Params: { id: string } }>('/api/portal/tasks/:id/archive', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN']); const t = getTask(p, request.params.id, b.version);
      if (p.tasks.some(x => !x.archived && x.dependencies.includes(t.id))) throw new PortalError('La tarea tiene dependientes activos.');
      t.archived = true; t.version++; event(p, user, 'Tarea archivada', text(b.reason, 'Motivo', 2000, true), t.id); return t;
    });
  });
  app.post<{ Params: { id: string } }>('/api/portal/tasks/:id/restore', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN']); const t = p.tasks.find(t => t.id === request.params.id && t.archived);
      if (!t) throw new PortalError('Tarea archivada no encontrada.', 404);
      if (t.version !== b.version) throw new PortalError('La tarea cambió. Actualiza antes de restaurar.', 409);
      if (t.dependencies.some(id => !p.tasks.some(x => x.id === id && !x.archived))) throw new PortalError('Restaura primero las dependencias archivadas.');
      t.archived = false; t.version++; t.updatedAt = new Date().toISOString();
      event(p, user, 'Tarea restaurada', text(b.reason, 'Motivo', 2000, true), t.id); return t;
    });
  });
  app.patch('/api/portal/settings', async request => {
    const user = await actor(request), b = body(request);
    return store.mutate(p => {
      permit(p, user, ['ADMIN']); if (b.version !== p.settingsVersion) throw new PortalError('El calendario cambió. Actualiza antes de guardar.', 409);
      const start = date(b.startDate); if (start && new Date(start + 'T12:00:00Z').getUTCDay() !== 1) throw new PortalError('El sprint debe comenzar un lunes.');
      if (typeof b.morazanicaPause !== 'boolean') throw new PortalError('Selecciona si aplica la pausa.');
      const reason = text(b.reason, 'Acuerdo del calendario', 2000, true);
      const virtualDay = b.virtualDay === undefined ? (p.virtualDay ?? 2) : b.virtualDay;
      if (typeof virtualDay !== 'number' || !Number.isInteger(virtualDay) || virtualDay < 0 || virtualDay > 6) throw new PortalError('Selecciona un día válido para la reunión virtual.');
      event(p, user, 'Calendario actualizado', `${p.startDate ?? 'Sin fecha'} → ${start ?? 'Sin fecha'}; pausa: ${p.morazanicaPause} → ${b.morazanicaPause}; día virtual (0=lunes): ${p.virtualDay ?? 2} → ${virtualDay}. ${reason}`);
      p.startDate = start; p.morazanicaPause = b.morazanicaPause; p.virtualDay = virtualDay; p.settingsVersion++; return { ok: true };
    });
  });
  app.post('/api/portal/members', async request => {
    const user = await actor(request), b = body(request);
    if (demo) throw new PortalError('La demo utiliza perfiles de prueba; la administración real estará disponible con MySQL.');
    if (user.role !== 'ADMIN') throw new PortalError('Solo coordinación puede crear usuarios.', 403);
    // Hash outside the transaction to keep the row lock short.
    const fields = passwordFields(b.password);
    return store.mutate(p => {
      permit(p, user, ['ADMIN']); const username = text(b.username, 'Usuario', 100, true).toLowerCase();
      if (!/^[a-z0-9._@-]+$/.test(username) || p.members.some(m => m.username === username)) throw new PortalError('Usuario inválido o duplicado.');
      if (!ROLES.includes(b.role as Role)) throw new PortalError('Rol inválido.');
      const member: Member = { id: randomUUID(), username, name: text(b.name, 'Nombre', 120, true), role: b.role as Role, active: true, ...fields };
      p.members.push(member); event(p, user, 'Usuario creado', `${member.name} · ${member.role}`); return safeMember(member);
    });
  });
  app.patch<{ Params: { id: string } }>('/api/portal/members/:id', async request => {
    const user = await actor(request), b = body(request);
    if (demo) throw new PortalError('Los perfiles de demostración son fijos.');
    if (user.role !== 'ADMIN') throw new PortalError('Solo coordinación puede administrar usuarios.', 403);
    const fields = b.password ? passwordFields(b.password) : undefined;
    return store.mutate(p => {
      permit(p, user, ['ADMIN']); const m = p.members.find(m => m.id === request.params.id);
      if (!m) throw new PortalError('Usuario no encontrado.', 404);
      if (typeof b.active !== 'boolean' || !ROLES.includes(b.role as Role)) throw new PortalError('Estado o rol inválido.');
      if (m.role === 'ADMIN' && (b.role !== 'ADMIN' || !b.active) && !p.members.some(x => x.id !== m.id && x.role === 'ADMIN' && x.active)) throw new PortalError('Debe quedar un administrador activo.');
      m.active = b.active; m.role = b.role as Role; if (fields) Object.assign(m, fields);
      p.sessions = p.sessions.filter(s => s.memberId !== m.id);
      event(p, user, 'Acceso actualizado', `${m.name} · ${m.role} · ${m.active ? 'activo' : 'inactivo'}`); return safeMember(m);
    });
  });
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/portal.js': ['portal.js', 'application/javascript; charset=utf-8'], '/portal.css': ['portal.css', 'text/css; charset=utf-8'],
    '/calendar.js': ['calendar.js', 'application/javascript; charset=utf-8'], '/logo.png': ['logo.png', 'image/png'], '/occidente.png': ['occidente.png', 'image/png'],
  };
  for (const [url, [filename, contentType]] of Object.entries(files)) app.get(url, async (_request, reply) => reply.type(contentType).send(await readFile(path.join(staticDir, filename))));
  app.get('/favicon.ico', (_request, reply) => reply.code(204).send());
  app.addHook('onClose', async () => store.close());
  return app;
}
