import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import DashboardPage from './pages/DashboardPage';
import CasesPage from './pages/CasesPage';
import NewCasePage from './pages/NewCasePage';
import CaseDetailPage from './pages/CaseDetailPage';
import PoliciesPage from './pages/PoliciesPage';
import LoginPage from './pages/LoginPage';
import IncomingRequestsPage from './pages/IncomingRequestsPage';
import EmailSettingsPage from './pages/EmailSettingsPage';
import { api } from './api';
import type { AuthUser } from './types';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    api.me()
      .then(({ user: current }) => active && setUser(current))
      .catch(() => active && setUser(null))
      .finally(() => active && setCheckingSession(false));
    const unauthorized = () => setUser(null);
    window.addEventListener('occidente:unauthorized', unauthorized);
    return () => {
      active = false;
      window.removeEventListener('occidente:unauthorized', unauthorized);
    };
  }, []);

  if (checkingSession) {
    return <main className="login-page"><div className="auth-loading">Verificando acceso seguro…</div></main>;
  }

  if (!user) {
    return <LoginPage onLogin={async (credentials) => {
      const response = await api.login(credentials.username, credentials.password, credentials.rememberDevice);
      setUser(response.user);
    }} />;
  }

  return (
    <Routes>
      <Route element={<Shell user={user} onLogout={() => setUser(null)} />}>
        <Route index element={<DashboardPage />} />
        <Route path="casos" element={<CasesPage />} />
        <Route path="casos/nuevo" element={<NewCasePage />} />
        <Route path="casos/:id" element={<CaseDetailPage />} />
        <Route path="politicas" element={<PoliciesPage />} />
        <Route path="solicitudes" element={<IncomingRequestsPage />} />
        <Route path="configuracion/correo" element={<EmailSettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
