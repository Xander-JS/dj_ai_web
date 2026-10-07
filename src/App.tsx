import React from 'react';

function App() {
  return (
    <div style={{ 
      padding: 'var(--space-8)', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 'var(--space-4)',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%'
    }}>
      <h1 style={{ color: 'var(--color-primary-500)' }}>
        SYSTEM DJ
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Design System Initialized
      </p>
      
      <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
        <button style={{
          backgroundColor: 'var(--color-primary-500)',
          color: 'var(--text-inverse)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          fontWeight: 'var(--font-weight-medium)',
        }}>
          Primary Token
        </button>
        <button style={{
          backgroundColor: 'var(--bg-surface-hover)',
          color: 'var(--text-primary)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-base)',
          fontWeight: 'var(--font-weight-medium)',
        }}>
          Surface Token
        </button>
      </div>
    </div>
  );
}

export default App;
