import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DesktopLayout } from './layouts/DesktopLayout';

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

function App() {
  return (
    <DesktopLayout>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/mixer" element={<Mixer />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </Suspense>
    </DesktopLayout>
  );
}

export default App;
