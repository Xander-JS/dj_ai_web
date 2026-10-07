import React from 'react';
import { DesktopLayout } from './layouts/DesktopLayout';
import { Button } from './components/ui/Button';

function App() {
  return (
    <DesktopLayout>
      <div style={{ padding: 'var(--space-8)' }}>
        <h2 style={{ marginBottom: 'var(--space-4)' }}>Bienvenido a SYSTEM DJ</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-8)' }}>
          El layout de escritorio ha sido montado correctamente.
        </p>
        
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <Button variant="primary">Explorar Biblioteca</Button>
          <Button variant="outline">Abrir Mixer</Button>
        </div>
      </div>
    </DesktopLayout>
  );
}

export default App;
