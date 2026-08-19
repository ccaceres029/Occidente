import { type FormEvent, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { OccidenteMark } from '../components/Brand';

type LoginPageProps = {
  onLogin: () => void;
};

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError('Ingresa tu usuario y contraseña para continuar.');
      return;
    }

    setError('');
    onLogin();
  };

  return (
    <main className="login-page">
      <section className="login-stage" aria-labelledby="login-title">
        <div className="login-brand-panel">
          <OccidenteMark />
          <div className="login-brand-panel__copy">
            <span>Portal operativo</span>
            <h1 id="login-title">Acceso AFPC Occidente</h1>
            <p>Control de expedientes, validaciones documentales y trazabilidad de decisiones.</p>
          </div>

          <div className="login-assurance" aria-label="Controles activos">
            <div>
              <ShieldCheck size={18} />
              <span>
                <strong>Seguridad aplicada</strong>
                <small>Sesiones y permisos por perfil</small>
              </span>
            </div>
            <div>
              <Fingerprint size={18} />
              <span>
                <strong>RDS preparado</strong>
                <small>Base dbOccidente</small>
              </span>
            </div>
          </div>
        </div>

        <form className="login-card" onSubmit={submitLogin}>
          <header>
            <span className="login-card__icon"><LockKeyhole size={22} /></span>
            <div>
              <h2>Iniciar sesion</h2>
              <p>Ingresa con tus credenciales institucionales.</p>
            </div>
          </header>

          <label className="login-field">
            <span>Usuario</span>
            <div>
              <UserRound size={18} aria-hidden="true" />
              <input
                autoComplete="username"
                autoFocus
                onChange={(event) => setUsername(event.target.value)}
                placeholder="usuario@occidente"
                type="text"
                value={username}
              />
            </div>
          </label>

          <label className="login-field">
            <span>Contraseña</span>
            <div>
              <KeyRound size={18} aria-hidden="true" />
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                className="login-field__icon-button"
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          <div className="login-options">
            <label>
              <input
                checked={rememberDevice}
                onChange={(event) => setRememberDevice(event.target.checked)}
                type="checkbox"
              />
              <span>Recordar equipo</span>
            </label>
            <button type="button">Recuperar acceso</button>
          </div>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button className="login-submit" type="submit">
            <span>Entrar</span>
            <ArrowRight size={18} />
          </button>

          <footer>
            <CheckCircle2 size={17} />
            <span>Modulo inicial listo para conectar autenticacion real.</span>
          </footer>
        </form>
      </section>
    </main>
  );
}
