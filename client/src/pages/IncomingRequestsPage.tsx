import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Clock3, Inbox, Mail, Paperclip, RefreshCw, Search, Trash2, UserRoundCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Toast } from '../components/ui';
import type { AuthUser, IncomingRequest } from '../types';

function receivedLabel(value: string): string {
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

export default function IncomingRequestsPage({
  currentUser,
  onUserChange,
}: {
  currentUser: AuthUser;
  onUserChange: (user: AuthUser) => void;
}) {
  const [items, setItems] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'danger' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IncomingRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingPreference, setSavingPreference] = useState<'refresh' | 'analysis' | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setItems((await api.incomingRequests()).items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible consultar la bandeja.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!currentUser.autoRefreshIncoming) return;
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [currentUser.autoRefreshIncoming, load]);

  const savePreference = async (
    key: 'autoRefreshIncoming' | 'autoAnalyzeCompleteCases',
    value: boolean,
  ) => {
    setSavingPreference(key === 'autoRefreshIncoming' ? 'refresh' : 'analysis');
    try {
      const result = await api.saveUserPreferences({
        autoRefreshIncoming: key === 'autoRefreshIncoming' ? value : currentUser.autoRefreshIncoming,
        autoAnalyzeCompleteCases: key === 'autoAnalyzeCompleteCases' ? value : currentUser.autoAnalyzeCompleteCases,
      });
      onUserChange(result.user);
      if (key === 'autoAnalyzeCompleteCases' && value) void load(true);
      setToast({ message: 'Preferencia guardada en tu perfil.' });
    } catch (preferenceError) {
      setToast({
        message: preferenceError instanceof Error ? preferenceError.message : 'No fue posible guardar la preferencia.',
        tone: 'danger',
      });
    } finally {
      setSavingPreference(null);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api.syncIncomingRequests();
      await load();
      const movedNotice = result.movedToTrash ? ` ${result.movedToTrash} correo(s) movido(s) a Papelera en SiteGround.` : '';
      setToast({ message: (result.generated
        ? `${result.generated} caso(s) generado(s) con ${result.documents} documento(s).`
        : result.imported ? `${result.imported} solicitud(es) nueva(s) recibida(s).` : 'La bandeja está al día.') + movedNotice });
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'No fue posible sincronizar el correo.');
    } finally {
      setSyncing(false);
    }
  };

  const deleteRequest = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const result = await api.deleteIncomingRequest(confirmDelete.id);
      setItems((current) => current.filter((item) => item.id !== confirmDelete.id));
      setToast({
        message: result.caseCode
          ? `${result.caseCode} y sus registros relacionados fueron eliminados.`
          : 'La solicitud entrante fue eliminada.',
      });
      setConfirmDelete(null);
    } catch (deleteError) {
      setToast({
        message: deleteError instanceof Error ? deleteError.message : 'No fue posible eliminar la solicitud.',
        tone: 'danger',
      });
    } finally {
      setDeleting(false);
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-HN');
    if (!term) return items;
    return items.filter((item) => [item.subject, item.senderName, item.senderEmail, item.snippet]
      .some((value) => value?.toLocaleLowerCase('es-HN').includes(term)));
  }, [items, search]);

  if (loading && items.length === 0) return <LoadingState label="Consultando solicitudes entrantes…" />;
  if (error && items.length === 0) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="incoming-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Recepción</div>
          <h2>Bandeja de Solicitudes</h2>
          <p>Correos recibidos en la cuenta configurada para iniciar el proceso de afiliación.</p>
        </div>
        <div className="page-lead__actions">
          <Badge tone="neutral"><Inbox size={14} /> {items.length} recibidas</Badge>
          <Button icon={<RefreshCw size={17} />} loading={syncing} onClick={() => void sync()}>Recibir ahora</Button>
        </div>
      </section>

      <section className="incoming-automation" aria-label="Automatización del perfil">
        <header><UserRoundCog size={19} /><span><strong>Automatización de {currentUser.displayName}</strong><small>Estas opciones se guardan únicamente en tu perfil.</small></span></header>
        <div>
          <label className="incoming-automation__option">
            <input type="checkbox" checked={currentUser.autoRefreshIncoming} disabled={savingPreference !== null} onChange={(event) => void savePreference('autoRefreshIncoming', event.target.checked)} />
            <RefreshCw size={17} className={savingPreference === 'refresh' ? 'is-spinning' : ''} />
            <span><strong>Actualización automática</strong><small>Recarga las solicitudes cada 30 segundos.</small></span>
          </label>
          <label className="incoming-automation__option">
            <input type="checkbox" checked={currentUser.autoAnalyzeCompleteCases} disabled={savingPreference !== null} onChange={(event) => void savePreference('autoAnalyzeCompleteCases', event.target.checked)} />
            <BrainCircuit size={17} className={savingPreference === 'analysis' ? 'is-spinning' : ''} />
            <span><strong>Análisis automático al 100%</strong><small>Inicia el análisis integral solo con la matriz documental completa.</small></span>
          </label>
        </div>
      </section>

      <section className="incoming-toolbar">
        <div className="search-field search-field--large"><Search size={18} /><input aria-label="Buscar solicitudes" placeholder="Buscar por remitente, asunto o contenido…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div><span className="status-dot" /> Sincronización IMAP activa</div>
      </section>

      {error && items.length > 0 && <div className="inline-error">{error}</div>}
      {visible.length === 0 ? (
        <EmptyState icon={<Mail size={25} />} title={items.length ? 'No hay coincidencias' : 'Aún no hay solicitudes recibidas'} body={items.length ? 'Ajusta el término de búsqueda para revisar otros mensajes.' : 'Usa “Recibir ahora” para consultar la cuenta IMAP configurada.'} />
      ) : (
        <section className={`incoming-list ${loading ? 'is-refreshing' : ''}`} aria-busy={loading}>
          <header className="incoming-list__header"><span>Remitente y solicitud</span><span>Recepción</span><span>Estado</span><span /></header>
          {visible.map((item) => (
            <article className="incoming-row" key={item.id}>
              <div className="incoming-row__avatar">{(item.senderName || item.senderEmail || 'S').slice(0, 1).toUpperCase()}</div>
              <div className="incoming-row__content">
                <div><strong>{item.subject}</strong>{item.hasAttachments && <Badge tone="neutral"><Paperclip size={12} /> {item.attachmentCount}</Badge>}</div>
                <span>{item.senderName || 'Remitente'} <small>{item.senderEmail}</small></span>
                <p>{item.snippet || 'Mensaje recibido sin contenido de texto.'}</p>
              </div>
              <div className="incoming-row__date"><Clock3 size={14} /><span>{receivedLabel(item.receivedAt)}</span></div>
              {item.caseId && item.caseCode
                ? <Link className="incoming-case-link" to={`/casos-generados/${item.caseId}`}>{item.caseCode}</Link>
                : <Badge tone={item.status === 'NEW' ? 'warning' : 'neutral'}>{item.status === 'NEW' ? 'Nueva' : item.status}</Badge>}
              {currentUser.role === 'ADMIN' && (
                <button className="icon-button row-delete-button" type="button" title="Eliminar registro" aria-label={`Eliminar ${item.caseCode || item.subject}`} onClick={() => setConfirmDelete(item)}>
                  <Trash2 size={16} />
                </button>
              )}
            </article>
          ))}
        </section>
      )}
      <Modal open={Boolean(confirmDelete)} title="Eliminar registro en cascada" description="Esta acción es irreversible y está restringida a administradores." onClose={() => !deleting && setConfirmDelete(null)}>
        {confirmDelete && <div className="cascade-delete"><Trash2 size={28} /><div><p>Se eliminará <strong>{confirmDelete.caseCode || confirmDelete.subject}</strong> junto con:</p><ul><li>El registro del correo recibido</li>{confirmDelete.caseCode && <li>El caso generado y sus documentos</li>}{confirmDelete.caseCode && <li>La carpeta completa del caso en S3</li>}</ul></div><footer><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button><Button variant="danger" loading={deleting} onClick={() => void deleteRequest()}>Eliminar definitivamente</Button></footer></div>}
      </Modal>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
