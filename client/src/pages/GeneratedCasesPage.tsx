import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, FileStack, FolderKanban, Mail, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, EmptyState, ErrorState, LoadingState } from '../components/ui';
import type { GeneratedCaseSummary } from '../types';

function dateLabel(value: string, withTime = false): string {
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

export default function GeneratedCasesPage() {
  const [items, setItems] = useState<GeneratedCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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
              <Badge tone={item.documentCount ? 'success' : 'neutral'}><FileStack size={12} /> {item.documentCount}</Badge>
              <Link to={`/casos-generados/${item.id}`} aria-label={`Abrir ${item.code}`}><ArrowRight size={17} /></Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
