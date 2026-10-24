import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthModal, type AuthView } from '../components/auth/AuthModal';
import { LandingTemplate } from '../components/templates/LandingTemplate';
import { useAuth } from '../context/AuthContext';

// Página pública de presentación: ofrece abrir la consola, iniciar sesión o registrarse
export const Landing: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isConfigured } = useAuth();
  const [requestedView, setRequestedView] = useState<AuthView | null>(null);
  const [redirectDismissed, setRedirectDismissed] = useState(false);

  // Llegada desde una ruta protegida sin sesión: se abre el login y luego se vuelve allí
  const redirectedFrom = (location.state as { from?: string } | null)?.from;
  const authView = requestedView ?? (redirectedFrom && !redirectDismissed ? 'login' : null);

  if (user) return <Navigate to={redirectedFrom ?? '/dashboard'} replace />;
  // Sin Supabase no hay cuentas: la consola funciona en modo local
  if (!isConfigured) return <Navigate to="/dashboard" replace />;

  const closeAuth = () => {
    // El state se conserva para volver a la ruta original tras iniciar sesión
    setRequestedView(null);
    setRedirectDismissed(true);
  };

  // La consola aplica su propia comprobación de sesión: sin usuario vuelve aquí con
  // `state.from` y se abre el login, que al completarse lleva de nuevo a la consola
  const openConsole = () => navigate('/dashboard');

  return (
    <>
      <LandingTemplate
        onLogIn={() => setRequestedView('login')}
        onSignUp={() => setRequestedView('signup')}
        onOpenConsole={openConsole}
      />
      {authView && (
        <AuthModal key={authView} open initialView={authView} onClose={closeAuth} />
      )}
    </>
  );
};
