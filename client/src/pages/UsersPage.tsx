import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, RotateCcw, Search, ShieldCheck, UserRoundCheck, UserRoundX, Users } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Toast } from '../components/ui';
import type { AuthUser, ManagedUser, UserInput } from '../types';

const roles = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'AFILIACIONES', label: 'Afiliaciones' },
  { value: 'CUMPLIMIENTO', label: 'Cumplimiento' },
  { value: 'CONSULTA', label: 'Consulta' },
];

type UserForm = Required<Pick<UserInput, 'username' | 'displayName' | 'role'>> & { active: boolean; password: string };

const emptyForm = (): UserForm => ({ username: '', displayName: '', role: 'AFILIACIONES', active: true, password: '' });

function roleLabel(role: string): string {
  return roles.find((item) => item.value === role)?.label || role;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium', timeZone: 'America/Tegucigalpa' }).format(new Date(value));
}

export default function UsersPage({ currentUser }: { currentUser: AuthUser }) {
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [deactivating, setDeactivating] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.users()).items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible consultar los usuarios.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-HN');
    if (!term) return items;
    return items.filter((item) => [item.displayName, item.username, roleLabel(item.role)]
      .some((value) => value.toLocaleLowerCase('es-HN').includes(term)));
  }, [items, search]);

  const openCreate = () => {
    setForm(emptyForm());
    setCreating(true);
  };

  const openEdit = (user: ManagedUser) => {
    setForm({ username: user.username, displayName: user.displayName, role: user.role, active: user.active, password: '' });
    setEditing(user);
  };

  const closeForm = () => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
  };

  const update = <K extends keyof UserForm>(key: K, value: UserForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (creating) {
        await api.createUser({ ...form, password: form.password });
        setToast({ message: 'Usuario creado correctamente.', tone: 'success' });
      } else if (editing) {
        await api.updateUser(editing.id, { ...form, ...(form.password ? { password: form.password } : {}) });
        setToast({ message: 'Usuario actualizado correctamente.', tone: 'success' });
      }
      setCreating(false);
      setEditing(null);
      await load();
    } catch (saveError) {
      setToast({ message: saveError instanceof Error ? saveError.message : 'No fue posible guardar el usuario.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!deactivating) return;
    setSaving(true);
    try {
      await api.deactivateUser(deactivating.id);
      setDeactivating(null);
      await load();
      setToast({ message: 'Usuario desactivado y sesiones revocadas.', tone: 'success' });
    } catch (deactivateError) {
      setToast({ message: deactivateError instanceof Error ? deactivateError.message : 'No fue posible desactivar el usuario.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const reactivate = async (user: ManagedUser) => {
    setSaving(true);
    try {
      await api.updateUser(user.id, { username: user.username, displayName: user.displayName, role: user.role, active: true });
      await load();
      setToast({ message: 'Usuario reactivado correctamente.', tone: 'success' });
    } catch (reactivateError) {
      setToast({ message: reactivateError instanceof Error ? reactivateError.message : 'No fue posible reactivar el usuario.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  if (loading && items.length === 0) return <LoadingState label="Cargando usuarios…" />;
  if (error && items.length === 0) return <ErrorState message={error} onRetry={() => void load()} />;

  const activeCount = items.filter((item) => item.active).length;
  const adminCount = items.filter((item) => item.active && item.role === 'ADMIN').length;

  return (
    <div className="users-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Seguridad</div>
          <h2>Administración de usuarios</h2>
          <p>Gestiona las cuentas autorizadas, sus roles operativos y el acceso al portal.</p>
        </div>
        <div className="page-lead__actions">
          <Badge tone="success" dot>{activeCount} activos</Badge>
          <Button icon={<Plus size={17} />} onClick={openCreate}>Crear usuario</Button>
        </div>
      </section>

      <section className="users-summary" aria-label="Resumen de usuarios">
        <div><Users size={19} /><span><small>Cuentas registradas</small><strong>{items.length}</strong></span></div>
        <div><UserRoundCheck size={19} /><span><small>Acceso habilitado</small><strong>{activeCount}</strong></span></div>
        <div><ShieldCheck size={19} /><span><small>Administradores activos</small><strong>{adminCount}</strong></span></div>
      </section>

      <section className="users-toolbar">
        <div className="search-field search-field--large"><Search size={18} /><input aria-label="Buscar usuarios" placeholder="Buscar por nombre, usuario o rol…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <span>{visible.length} de {items.length} usuarios</span>
      </section>

      {error && <div className="inline-error">{error}</div>}
      {visible.length === 0 ? (
        <EmptyState icon={<Users size={25} />} title="No hay coincidencias" body="Ajusta el término de búsqueda para revisar otras cuentas." />
      ) : (
        <section className="users-table" aria-busy={loading}>
          <header><span>Usuario</span><span>Rol</span><span>Estado</span><span>Actualización</span><span>Acciones</span></header>
          {visible.map((user) => (
            <article key={user.id} className={!user.active ? 'is-inactive' : ''}>
              <div className="users-table__identity"><span>{user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.username}</small>{user.id === currentUser.id && <em>Sesión actual</em>}</div></div>
              <Badge tone={user.role === 'ADMIN' ? 'success' : 'neutral'}>{roleLabel(user.role)}</Badge>
              <Badge tone={user.active ? 'success' : 'neutral'} dot>{user.active ? 'Activo' : 'Inactivo'}</Badge>
              <time dateTime={user.updatedAt}>{dateLabel(user.updatedAt)}</time>
              <div className="users-table__actions">
                <button type="button" title="Editar usuario" aria-label={`Editar ${user.displayName}`} onClick={() => openEdit(user)}><Pencil size={16} /></button>
                {user.active ? (
                  <button type="button" className="is-danger" title="Desactivar usuario" aria-label={`Desactivar ${user.displayName}`} disabled={user.id === currentUser.id} onClick={() => setDeactivating(user)}><UserRoundX size={16} /></button>
                ) : (
                  <button type="button" title="Reactivar usuario" aria-label={`Reactivar ${user.displayName}`} disabled={saving} onClick={() => void reactivate(user)}><RotateCcw size={16} /></button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <Modal open={creating || Boolean(editing)} title={creating ? 'Crear usuario' : 'Editar usuario'} description={creating ? 'La contraseña inicial debe tener al menos 12 caracteres.' : 'Deja la contraseña vacía para conservar la actual.'} onClose={closeForm}>
        <form className="user-form" onSubmit={save}>
          <div className="form-grid">
            <label className="field field--wide"><span>Nombre completo <b>*</b></span><input required minLength={2} maxLength={255} autoFocus value={form.displayName} onChange={(event) => update('displayName', event.target.value)} /></label>
            <label className="field"><span>Usuario <b>*</b></span><input required minLength={3} maxLength={191} autoComplete="username" value={form.username} onChange={(event) => update('username', event.target.value)} /></label>
            <label className="field"><span>Rol <b>*</b></span><select required value={form.role} onChange={(event) => update('role', event.target.value)}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
            <label className="field field--wide"><span>{creating ? 'Contraseña inicial' : 'Nueva contraseña'} {creating && <b>*</b>}</span><div className="user-password"><KeyRound size={17} /><input type="password" required={creating} minLength={12} autoComplete="new-password" placeholder={creating ? 'Mínimo 12 caracteres' : 'Dejar vacío para conservarla'} value={form.password} onChange={(event) => update('password', event.target.value)} /></div></label>
          </div>
          <footer className="user-form__actions"><Button type="button" variant="ghost" onClick={closeForm}>Cancelar</Button><Button type="submit" loading={saving}>{creating ? 'Crear usuario' : 'Guardar cambios'}</Button></footer>
        </form>
      </Modal>

      <Modal open={Boolean(deactivating)} title="Desactivar usuario" description="La cuenta dejará de acceder al portal y sus sesiones abiertas serán revocadas." onClose={() => !saving && setDeactivating(null)}>
        {deactivating && <div className="deactivate-user"><UserRoundX size={28} /><p>¿Confirmas que deseas desactivar a <strong>{deactivating.displayName}</strong>?</p><footer><Button type="button" variant="ghost" onClick={() => setDeactivating(null)}>Cancelar</Button><Button type="button" variant="danger" loading={saving} onClick={() => void deactivate()}>Desactivar</Button></footer></div>}
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
