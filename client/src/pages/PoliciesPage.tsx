import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, GitBranch, ListChecks, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { api } from '../api';
import type { PolicyCatalog, PolicyRule } from '../types';
import { Badge, ErrorState, LoadingState } from '../components/ui';
import { documentTypeLabel, spanishDynamicText } from '../utils';

const severityTone = (severity: string) => {
  if (severity === 'error') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
};

const severityLabel = (severity: string) => {
  if (severity === 'error') return 'Bloqueante';
  if (severity === 'warning') return 'Alerta';
  return 'Informativa';
};

function SummaryCard({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
  return (
    <article className="policy-summary-card">
      <i>{icon}</i>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function RuleCard({ rule }: { rule: PolicyRule }) {
  return (
    <article className="policy-rule-card">
      <header>
        <div>
          <span>{rule.domain}</span>
          <h3>{rule.title}</h3>
        </div>
        <Badge tone={severityTone(rule.severity)}>{severityLabel(rule.severity)}</Badge>
      </header>
      <dl>
        <div>
          <dt>Disparador</dt>
          <dd>{spanishDynamicText(rule.trigger)}</dd>
        </div>
        <div>
          <dt>Acción configurada</dt>
          <dd>{spanishDynamicText(rule.action)}</dd>
        </div>
      </dl>
      <div className="policy-rule-card__meta">
        <span><ShieldCheck size={14} /> {rule.owner}</span>
        <span><SlidersHorizontal size={14} /> {rule.configurable ? 'Parametrizable' : 'Regla fija'}</span>
        <span><CheckCircle2 size={14} /> {rule.status}</span>
      </div>
      <footer>
        <div>
          <strong>Evidencia esperada</strong>
          <p>{rule.evidence.map(spanishDynamicText).join(' · ')}</p>
        </div>
        <Badge tone="neutral">{spanishDynamicText(rule.policyRef)}</Badge>
      </footer>
    </article>
  );
}

export default function PoliciesPage() {
  const [catalog, setCatalog] = useState<PolicyCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState('Todos');

  const load = () => {
    setError(null);
    api.policies()
      .then(setCatalog)
      .catch((err) => setError(err instanceof Error ? err.message : 'No fue posible cargar las políticas.'));
  };

  useEffect(() => load(), []);

  const domains = useMemo(() => {
    if (!catalog) return ['Todos'];
    return ['Todos', ...Array.from(new Set(catalog.rules.map((rule) => rule.domain)))];
  }, [catalog]);

  const visibleRules = useMemo(() => {
    if (!catalog) return [];
    return domain === 'Todos' ? catalog.rules : catalog.rules.filter((rule) => rule.domain === domain);
  }, [catalog, domain]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!catalog) return <LoadingState label="Cargando políticas y reglas parametrizadas..." />;

  return (
    <div className="policies-page">
      <section className="page-lead page-lead--compact">
        <div>
          <span className="eyebrow"><span /> Motor determinístico</span>
          <h2>Políticas y reglas parametrizadas</h2>
          <p>
            Catálogo local del demo: muestra las reglas activas, el efecto operativo y la evidencia que
            el portal usa para analizar los expedientes.
          </p>
        </div>
        <div className="policy-version">
          <Badge tone="success">{catalog.version}</Badge>
          <small>{catalog.mode}</small>
        </div>
      </section>

      <section className="policy-summary-grid">
        <SummaryCard label="Reglas activas" value={catalog.summary.activeRules} detail="Controles ejecutados por expediente" icon={<ListChecks size={20} />} />
        <SummaryCard label="Bloqueantes" value={catalog.summary.blockingRules} detail="Impiden aprobar hasta subsanar" icon={<AlertTriangle size={20} />} />
        <SummaryCard label="Cumplimiento" value={catalog.summary.complianceRules} detail="Derivan a decisión especializada" icon={<ShieldCheck size={20} />} />
        <SummaryCard label="Parametrizables" value={catalog.summary.configurableRules} detail="Listas para ajustar en piloto" icon={<SlidersHorizontal size={20} />} />
      </section>

      <section className="policy-layout">
        <div className="policy-main">
          <section className="policy-section">
            <header className="policy-section__header">
              <div>
                <h3>Motor de reglas</h3>
                <p>Reglas que se ejecutan después de crear, corregir o revalidar un expediente.</p>
              </div>
              <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="Filtrar por dominio">
                {domains.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </header>
            <div className="policy-rules-list">
              {visibleRules.map((rule) => <RuleCard key={rule.code} rule={rule} />)}
            </div>
          </section>
        </div>

        <aside className="policy-aside">
          <section className="policy-section policy-section--compact">
            <header><FileCheck2 size={18} /><h3>Matriz documental</h3></header>
            <div className="policy-document-list">
              {catalog.documentMatrix.map((item) => (
                <article key={item.type}>
                  <strong>{documentTypeLabel(item.type)}</strong>
                  <span>{item.condition}</span>
                  <small>{item.owner} · {item.policyRef}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="policy-section policy-section--compact">
            <header><GitBranch size={18} /><h3>Bandas de revisión</h3></header>
            <div className="policy-band-list">
              {catalog.riskBands.map((band) => (
                <article key={`${band.range}-${band.route}`}>
                  <Badge tone={band.route === 'Cumplimiento' ? 'warning' : band.route === 'Revisión reforzada' ? 'info' : 'success'}>{band.route}</Badge>
                  <strong>{band.range}</strong>
                  <p>{band.review}</p>
                  <small>{band.policyRef}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="policy-section policy-section--compact policy-section--notice">
            <header><ShieldCheck size={18} /><h3>Notas de control</h3></header>
            {catalog.disclaimers.map((item) => <p key={item}>{item}</p>)}
          </section>
        </aside>
      </section>
    </div>
  );
}
