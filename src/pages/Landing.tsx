import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LandingTemplate } from '../components/templates/LandingTemplate';

// Página pública de presentación: `/` siempre la muestra, haya sesión o no. Ofrece abrir la
// consola, iniciar sesión o registrarse
export const Landing: React.FC = () => {
  const navigate = useNavigate();

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
