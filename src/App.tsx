import { Routes, Route, Navigate } from 'react-router-dom';
import { DesktopLayout } from './layouts/DesktopLayout';

import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Playlists } from './pages/Playlists';
import { Mixer } from './pages/Mixer';
import { Settings } from './pages/Settings';
import { Profile } from './pages/Profile';

function App() {
  return (
    <DesktopLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/playlists" element={<Playlists />} />
        <Route path="/mixer" element={<Mixer />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </DesktopLayout>
  );
}

export default App;
