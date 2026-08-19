import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, FileStack, FolderKanban, Mail, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Toast } from '../components/ui';
import type { AuthUser, GeneratedCaseSummary } from '../types';

function dateLabel(value: string, withTime = false): string {
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

export default function GeneratedCasesPage({ currentUser }: { currentUser: AuthUser }) {
  const [items, setItems] = useState<GeneratedCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<GeneratedCaseSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'danger' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.generatedCases()).items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible consultar los casos generados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-HN');
    if (!term) return items;
    return items.filter((item) => [item.code, item.subject, item.senderName, item.senderEmail]
      .some((value) => value?.toLocaleLowerCase('es-HN').includes(term)));
  }, [items, search]);

  if (loading && !items.length) return <LoadingState label="Cargando casos generados…" />;
  if (error && !items.length) return <ErrorState message={error} onRetry={() => void load()} />;

  const documentTotal = items.reduce((sum, item) => sum + item.documentCount, 0);

  const deleteCase = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const result = await api.deleteGeneratedCase(confirmDelete.id);
      setItems((current) => current.filter((item) => item.id !== confirmDelete.id));
      setToast({ message: `${result.code} y sus registros relacionados fueron eliminados.` });
      setConfirmDelete(null);
    } catch (deleteError) {
      setToast({
        message: deleteError instanceof Error ? deleteError.message : 'No fue posible eliminar el caso.',
        tone: 'danger',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="generated-cases-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Ingesta documental</div>
          <h2>Casos Generados</h2>
          <p>Cada correo recibido se codifica y conserva con todos sus documentos adjuntos.</p>
        </div>
        <div className="page-lead__actions"><Badge tone="success" dot>{items.length} casos</Badge></div>
      </section>

      <section className="generated-summary" aria-label="Resumen de casos generados">
        <div><FolderKanban size={20} /><span><small>Casos creados</small><strong>{items.length}</strong></span></div>
        <div><FileStack size={20} /><span><small>Documentos en S3</small><strong>{documentTotal}</strong></span></div>
        <div><CalendarDays size={20} /><span><small>Última recepción</small><strong>{items[0] ? dateLabel(items[0].receivedAt) : 'Sin datos'}</strong></span></div>
      </section>

      <section className="generated-toolbar">
        <div className="search-field search-field--large"><Search size={18} /><input aria-label="Buscar casos generados" placeholder="Buscar por código, asunto o remitente…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <span>Almacenamiento privado · S3 / demo-occi</span>
      </section>

      {visible.length === 0 ? (
        <EmptyState icon={<FolderKanban size={26} />} title={items.length ? 'No hay coincidencias' : 'Aún no hay casos generados'} body={items.length ? 'Ajusta el término de búsqueda.' : 'Recibe los correos desde Solicitudes entrantes para iniciar la codificación.'} />
      ) : (
        <section className="generated-list" aria-busy={loading}>
          <header><span>Caso y solicitud</span><span>Remitente</span><span>Recepción</span><span>Documentos</span><span /></header>
          {visible.map((item) => (
            <article key={item.id}>
              <div className="generated-list__case"><span><Mail size={18} /></span><div><strong>{item.code}</strong><p>{item.subject}</p></div></div>
              <div className="generated-list__sender"><strong>{item.senderName || 'Remitente'}</strong><small>{item.senderEmail || 'Sin dirección disponible'}</small></div>
              <time dateTime={item.receivedAt}>{dateLabel(item.receivedAt, true)}</time>
              <Badge tone={item.documentAnalysis?.missingCount ? 'warning' : item.documentCount ? 'success' : 'neutral'}>
                <FileStack size={12} /> {item.documentCount}{item.documentAnalysis ? ` · ${item.documentAnalysis.completenessPercent}%` : ''}
              </Badge>
              <div className="generated-list__actions">
                <Link to={`/casos-generados/${item.id}`} title="Abrir caso" aria-label={`Abrir ${item.code}`}><ArrowRight size={17} /></Link>
                {currentUser.role === 'ADMIN' && <button className="icon-button row-delete-button" type="button" title="Eliminar caso" aria-label={`Eliminar ${item.code}`} onClick={() => setConfirmDelete(item)}><Trash2 size={16} /></button>}
              </div>
            </article>
          ))}
        </section>
      )}
      <Modal open={Boolean(confirmDelete)} title="Eliminar caso en cascada" description="Esta acción es irreversible y está restringida a administradores." onClose={() => !deleting && setConfirmDelete(null)}>
        {confirmDelete && <div className="cascade-delete"><Trash2 size={28} /><div><p>Se eliminará <strong>{confirmDelete.code}</strong> junto con:</p><ul><li>El registro del correo recibido</li><li>Los {confirmDelete.documentCount} documentos relacionados</li><li>La carpeta completa del caso en S3</li></ul></div><footer><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button><Button variant="danger" loading={deleting} onClick={() => void deleteCase()}>Eliminar definitivamente</Button></footer></div>}
      </Modal>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
