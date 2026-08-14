import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Check, LoaderCircle, RotateCcw, X } from 'lucide-react';

export function Badge({ tone = 'neutral', children, dot = false }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Button({
  variant = 'primary',
  loading = false,
  icon,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button className={`button button--${variant} ${className}`.trim()} disabled={loading || props.disabled} {...props}>
      {loading ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.min(100, Math.max(0, value || 0));
  return (
    <div className="progress-wrap">
      {label && (
        <div className="progress-label">
          <span>{label}</span>
          <strong>{clamped}%</strong>
        </div>
      )}
      <div className="progress" aria-label={label || 'Progreso'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} role="progressbar">
        <span style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function LoadingState({ label = 'Cargando información…' }: { label?: string }) {
  return (
    <div className="state-card state-card--loading" role="status">
      <LoaderCircle className="spin" size={30} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span>Consultando la fuente local de la demostración.</span>
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-card state-card--error" role="alert">
      <AlertCircle size={30} aria-hidden="true" />
      <div>
        <strong>No pudimos cargar esta vista</strong>
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" icon={<RotateCcw size={16} />} onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal__header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar diálogo">
            <X size={20} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}

export function Toast({ message, tone = 'success', onDismiss }: { message: string; tone?: 'success' | 'danger'; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${tone}`} role="status">
      {tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Cerrar notificación"><X size={16} /></button>
    </div>
  );
}
