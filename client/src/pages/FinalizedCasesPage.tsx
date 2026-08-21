import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, CheckCircle2, Download, FileSpreadsheet, FileStack, History, Search } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Toast } from '../components/ui';
import type { GeneratedCaseSummary } from '../types';

function dateLabel(value?: string): string {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Tegucigalpa',
  }).format(new Date(value));
}

export default function FinalizedCasesPage() {
  const location = useLocation();
  const [items, setItems] = useState<GeneratedCaseSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const finalizedCode = (location.state as { finalized?: string } | null)?.finalized;
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'danger' } | null>(
    finalizedCode ? { message: `${finalizedCode} fue enviado a Casos finalizados.` } : null,
  );

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.finalizedCases();
      setItems(response.items);
      setSelected((current) => new Set([...current].filter((id) => response.items.some((item) => item.id === id))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible consultar los casos finalizados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-HN');
    if (!term) return items;
    return items.filter((item) => [item.code, item.subject, item.senderName, item.finalizedBy]
      .some((value) => value?.toLocaleLowerCase('es-HN').includes(term)));
  }, [items, search]);

  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visible.forEach((item) => next.delete(item.id));
    else visible.forEach((item) => next.add(item.id));
    return next;
  });

  const exportFiles = async () => {
    setExporting(true);
    try {
      await api.downloadFinalizedCases([...selected]);
      setToast({ message: `Se generaron los dos archivos para ${selected.size} caso(s) seleccionado(s).` });
    } catch (exportError) {
      setToast({
        message: exportError instanceof Error ? exportError.message : 'No fue posible generar los archivos.',
        tone: 'danger',
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading && !items.length) return <LoadingState label="Cargando casos finalizados…" />;
  if (error && !items.length) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="finalized-cases-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Salida supervisada</div>
          <h2>Casos Finalizados</h2>
          <p>Expedientes aprobados por una persona y listos para generar los archivos de carga.</p>
        </div>
        <div className="page-lead__actions">
          <Badge tone="success" dot>{items.length} finalizados</Badge>
          <Button variant="success" icon={<Download size={16} />} disabled={!selected.size} loading={exporting} onClick={() => void exportFiles()}>
            Generar 2 archivos {selected.size ? `(${selected.size})` : ''}
          </Button>
        </div>
      </section>

      <section className="finalized-export-summary" aria-label="Archivos que se generarán">
        <div><FileSpreadsheet size={21} /><span><strong>Archivo_Afiliados.xls</strong><small>63 columnas · una fila por caso</small></span></div>
        <div><FileSpreadsheet size={21} /><span><strong>Archivo_Beneficiario.xls</strong><small>15 columnas · beneficiarios extraídos</small></span></div>
        <div><CheckCircle2 size={21} /><span><strong>{selected.size} seleccionado(s)</strong><small>Se descargarán juntos en un ZIP</small></span></div>
      </section>

      <section className="generated-toolbar finalized-toolbar">
        <div className="search-field search-field--large"><Search size={18} /><input aria-label="Buscar casos finalizados" placeholder="Buscar por código, asunto o aprobador…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <Button variant="ghost" onClick={toggleVisible} disabled={!visible.length}>{allVisibleSelected ? 'Quitar selección visible' : 'Seleccionar visibles'}</Button>
      </section>

      {visible.length === 0 ? (
        <EmptyState icon={<Archive size={26} />} title={items.length ? 'No hay coincidencias' : 'Aún no hay casos finalizados'} body={items.length ? 'Ajusta el término de búsqueda.' : 'Usa el botón “Apruebo” en Casos generados para enviar expedientes a esta pantalla.'} />
      ) : (
        <section className="finalized-list" aria-busy={loading}>
          <header><span><input type="checkbox" aria-label="Seleccionar todos los casos visibles" checked={allVisibleSelected} onChange={toggleVisible} /></span><span>Caso</span><span>Aprobado por</span><span>Fecha de aprobación</span><span>Documentos</span><span /></header>
          {visible.map((item) => (
            <article className={selected.has(item.id) ? 'is-selected' : ''} key={item.id}>
              <label><input type="checkbox" aria-label={`Seleccionar ${item.code}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></label>
              <div className="generated-list__case"><span><Archive size={18} /></span><div><strong>{item.code}</strong><p>{item.subject}</p></div></div>
              <div className="generated-list__sender"><strong>{item.finalizedBy || 'Usuario autorizado'}</strong><small>{item.senderName || item.senderEmail || 'Remitente no identificado'}</small></div>
              <time dateTime={item.finalizedAt}>{dateLabel(item.finalizedAt)}</time>
              <Badge tone="neutral"><FileStack size={12} /> {item.documentCount}</Badge>
              <div className="finalized-list__actions">
                <Link className="audit-case-link" to={`/casos-generados/${item.id}?view=audit`} title="Ver auditoría" aria-label={`Ver auditoría de ${item.code}`}><History size={15} /><span>Auditoría</span></Link>
                <Link to={`/casos-generados/${item.id}`} title="Abrir caso finalizado" aria-label={`Abrir ${item.code}`}><ArrowRight size={17} /></Link>
              </div>
            </article>
          ))}
        </section>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}
