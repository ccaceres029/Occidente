import { ArrowRight, Building2, Clock3, ShieldAlert, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CaseSummary } from '../types';
import { formatCurrency, identityTypeLabel, relativeAge, riskLevelLabel, riskRouteLabel, riskTone, spanishDynamicText, statusTone, titleFromStatus } from '../utils';
import { Badge, Progress } from './ui';

export function CaseCard({ item, compact = false }: { item: CaseSummary; compact?: boolean }) {
  return (
    <article className={`case-card ${compact ? 'case-card--compact' : ''}`}>
      <div className="case-card__identity">
        <div className="document-avatar" aria-hidden="true">{item.client.fullName?.slice(0, 1) || 'C'}</div>
        <div>
          <div className="case-card__reference">
            <span>{spanishDynamicText(item.reference)}</span>
            <Badge tone={statusTone(item.status)} dot>{titleFromStatus(item.status, item.statusLabel)}</Badge>
          </div>
          <h3>{spanishDynamicText(item.client.fullName || 'Cliente sintético')}</h3>
          <p>{identityTypeLabel(item.client.idType)} · {item.client.idNumberMasked}</p>
        </div>
      </div>

      {!compact && (
        <>
          <div className="case-card__meta">
            <span><Building2 size={15} />{spanishDynamicText(item.agency)}</span>
            <span><UserRound size={15} />{spanishDynamicText(item.assignee || 'Sin asignar')}</span>
          </div>
          <div className="case-card__amount">
            <span>Aporte propuesto</span>
            <strong>{formatCurrency(item.product.contributionAmount, item.product.currency)}</strong>
            <small>{item.product.frequency}</small>
          </div>
          <div className="case-card__risk">
            <span>Ruta de análisis</span>
            <Badge tone={riskTone(item.risk.level)}><ShieldAlert size={13} /> Riesgo {riskLevelLabel(item.risk.level)}</Badge>
            <small>{riskRouteLabel(item.risk.route)}</small>
          </div>
          <div className="case-card__sla">
            <span className={item.sla.breached ? 'text-danger' : ''}><Clock3 size={15} />{relativeAge(item.sla.ageHours)}</span>
            <Progress value={item.progress} />
          </div>
        </>
      )}

      {compact && (
        <div className="case-card__compact-meta">
          <span>{formatCurrency(item.product.contributionAmount, item.product.currency)}</span>
          <span><Clock3 size={14} />{relativeAge(item.sla.ageHours)}</span>
        </div>
      )}

      <Link className="case-card__open" to={`/casos/${item.id}`} aria-label={`Abrir expediente ${spanishDynamicText(item.reference)}`}>
        <ArrowRight size={19} />
      </Link>
    </article>
  );
}
