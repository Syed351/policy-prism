import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { Loading } from './components/ui';
import { useAuth } from './hooks/useAuth';
import AuditPage from './pages/AuditPage';
import DashboardPage from './pages/DashboardPage';
import FacilityPage from './pages/FacilityPage';
import GapsPage from './pages/GapsPage';
import LoginPage from './pages/LoginPage';
import MappingPage from './pages/MappingPage';
import PoliciesPage from './pages/PoliciesPage';
import PolicyCheckPage from './pages/PolicyCheckPage';
import RegulationsPage from './pages/RegulationsPage';
import ReportsPage from './pages/ReportsPage';
import ReviewPage from './pages/ReviewPage';

/** Blocks the app shell until a session is confirmed. */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Restoring your session\u2026" />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Landing point for the link in a password-reset email. */}
      <Route path="/reset-password" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/facility" element={<FacilityPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/regulations" element={<RegulationsPage />} />
        <Route path="/mapping" element={<MappingPage />} />
        <Route path="/policy-check" element={<PolicyCheckPage />} />
        <Route path="/gaps" element={<GapsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
