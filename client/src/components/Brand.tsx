import type { SVGProps } from 'react';

const portalLogo = '/afpc-occidente-logo.png';

export function OccidenteMark({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  if (!compact) {
    return (
      <div className={`brand brand--official ${className}`.trim()}>
        <span className="brand__official-logo">
          <img src={portalLogo} alt="Logotipo de AFPC Occidente" />
        </span>
        <span className="brand__solution">AFPC · Mesa de Control</span>
      </div>
    );
  }

  return (
    <div className={`brand brand--compact ${className}`.trim()}>
      <img className="brand__compact-logo" src={portalLogo} alt="Logotipo de AFPC Occidente" />
    </div>
  );
}

export function PatternMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 180 180" fill="none" aria-hidden="true" {...props}>
      <circle cx="90" cy="90" r="78" stroke="currentColor" strokeWidth="1.5" opacity=".12" />
      <circle cx="90" cy="90" r="55" stroke="currentColor" strokeWidth="1.5" opacity=".12" />
      <circle cx="90" cy="90" r="31" stroke="currentColor" strokeWidth="1.5" opacity=".12" />
      <path d="M90 12a78 78 0 0 1 76 60H144a56 56 0 0 0-54-38V12Z" fill="currentColor" opacity=".07" />
    </svg>
  );
}
