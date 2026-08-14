import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import DashboardPage from './pages/DashboardPage';
import CasesPage from './pages/CasesPage';
import NewCasePage from './pages/NewCasePage';
import CaseDetailPage from './pages/CaseDetailPage';
import PoliciesPage from './pages/PoliciesPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="casos" element={<CasesPage />} />
        <Route path="casos/nuevo" element={<NewCasePage />} />
        <Route path="casos/:id" element={<CaseDetailPage />} />
        <Route path="politicas" element={<PoliciesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
