import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FilePlus2, Filter, Inbox, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api';
import { CaseCard } from '../components/CaseCard';
import { Badge, Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import type { CaseSummary } from '../types';

const statusFilters = [
  { value: '', label: 'Todos' },
  { value: 'RECIBIDO', label: 'Recibidos' },
  { value: 'EN_REVISION', label: 'En revisión' },
  { value: 'DEVUELTO', label: 'Devueltos' },
  { value: 'ESCALADO_CUMPLIMIENTO', label: 'Cumplimiento' },
  { value: 'LISTO_CORE', label: 'Listos para sistema central' },
];

export default function CasesPage() {
  const [searchParams] = useSearchParams();
  const querySearch = searchParams.get('search') || '';
  const [items, setItems] = useState<CaseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(querySearch);
  const [risk, setRisk] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.cases({ status, search: search.trim() });
      setItems(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => setSearch(querySearch), [querySearch]);

  const filteredItems = useMemo(() => {
    if (!risk) return items;
    return items.filter((item) => item.risk.level.toLowerCase().includes(risk.toLowerCase()));
  }, [items, risk]);

  const activeFilters = [status, risk, search].filter(Boolean).length;

  return (
    <div className="cases-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Operación AFPC</div>
          <h2>Bandeja de afiliaciones</h2>
          <p>Gestiona los expedientes por prioridad, riesgo y etapa del proceso.</p>
        </div>
        <Link className="button button--primary" to="/casos/nuevo"><FilePlus2 size={17} /><span>Nueva afiliación</span></Link>
      </section>

      <section className="filter-panel" aria-label="Filtros de casos">
        <div className="search-field search-field--large">
          <Search size={18} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por referencia, nombre o identificación…" aria-label="Buscar expedientes" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><X size={16} /></button>}
        </div>
        <label className="select-control">
          <SlidersHorizontal size={16} />
          <span className="sr-only">Filtrar por riesgo</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value)}>
            <option value="">Todos los riesgos</option>
            <option value="bajo">Riesgo bajo</option>
            <option value="medio">Riesgo medio</option>
            <option value="alto">Riesgo alto</option>
          </select>
        </label>
        {activeFilters > 0 && (
          <Button variant="ghost" icon={<X size={16} />} onClick={() => { setStatus(''); setRisk(''); setSearch(''); }}>
            Limpiar ({activeFilters})
          </Button>
        )}
      </section>

      <div className="status-filter-row" role="group" aria-label="Estado del expediente">
        {statusFilters.map((filter) => (
          <button className={status === filter.value ? 'is-active' : ''} type="button" key={filter.value} onClick={() => setStatus(filter.value)}>
            {filter.label}
          </button>
        ))}
      </div>

      <div className="list-summary">
        <div><strong>{filteredItems.length}</strong> de {total} expedientes</div>
        <div><Badge tone="neutral"><Filter size={13} /> Ordenados por última actualización</Badge></div>
      </div>

      {error && items.length > 0 && <div className="inline-error">{error}</div>}
      {loading && items.length === 0 ? (
        <LoadingState label="Consultando la bandeja…" />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<Inbox size={25} />}
          title="No hay expedientes con estos filtros"
          body="Prueba con otra búsqueda o limpia los filtros para ver todos los casos."
          action={<Button variant="secondary" onClick={() => { setStatus(''); setRisk(''); setSearch(''); }}>Limpiar filtros</Button>}
        />
      ) : (
        <div className={`case-list ${loading ? 'is-refreshing' : ''}`} aria-busy={loading}>
          {filteredItems.map((item) => <CaseCard item={item} key={item.id} />)}
        </div>
      )}
    </div>
  );
}
