import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LandingTemplate } from '../components/templates/LandingTemplate';
import { useAuth } from '../context/AuthContext';

// Página pública de presentación: ofrece abrir la consola, iniciar sesión o registrarse
export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const { user, isConfigured } = useAuth();

  if (user) return <Navigate to="/dashboard" replace />;
  // Sin Supabase no hay cuentas: la consola funciona en modo local
  if (!isConfigured) return <Navigate to="/dashboard" replace />;

  // La consola aplica su propia comprobación de sesión: sin usuario lleva a /login con
  // `state.from`, y el acceso devuelve después a la consola
  const openConsole = () => navigate('/dashboard');

  return (
    <LandingTemplate
      onLogIn={() => navigate('/login')}
      onSignUp={() => navigate('/signup')}
      onOpenConsole={openConsole}
    />
  );
};
