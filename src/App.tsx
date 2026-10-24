import { lazy, Suspense } from 'react';
import { Routes, Route, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DesktopLayout } from './layouts/DesktopLayout';
import { UpdatePasswordModal } from './components/auth/UpdatePasswordModal';
import { useAuth } from './context/AuthContext';

const Landing = lazy(() => import('./pages/Landing').then((module) => ({ default: module.Landing })));
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const SignUp = lazy(() => import('./pages/SignUp').then((module) => ({ default: module.SignUp })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Library = lazy(() => import('./pages/Library').then((module) => ({ default: module.Library })));
const Playlists = lazy(() => import('./pages/Playlists').then((module) => ({ default: module.Playlists })));
const Mixer = lazy(() => import('./pages/Mixer').then((module) => ({ default: module.Mixer })));
const Sessions = lazy(() => import('./pages/Sessions').then((module) => ({ default: module.Sessions })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Profile = lazy(() => import('./pages/Profile').then((module) => ({ default: module.Profile })));

function RouteLoading() {
  const { t } = useTranslation();
  return <div role="status" aria-live="polite">{t('states.loading')}</div>;
}

// Rutas de la consola: requieren sesión y comparten el shell Header/Sidebar/PlayerBar.
// Sin Supabase configurado no hay cuentas posibles, así que la consola queda en modo local.
function ConsoleShell() {
  const { user, loading, isConfigured } = useAuth();
  const location = useLocation();

  if (isConfigured && loading) return <RouteLoading />;
  if (isConfigured && !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <DesktopLayout>
      <Suspense fallback={<RouteLoading />}>
        <Outlet />
      </Suspense>
    </DesktopLayout>
  );
}

function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route element={<ConsoleShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/mixer" element={<Mixer />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Routes>
      <UpdatePasswordModal />
    </Suspense>
  );
}

export default App;
