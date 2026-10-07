import React from 'react';
import './DesktopLayout.css';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PlayerBar } from './PlayerBar';

export interface DesktopLayoutProps {
  children: React.ReactNode;
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({ children }) => {
  return (
    <div className="desktop-layout">
      <Header />
      <Sidebar />
      <main className="layout-main">
        {children}
      </main>
      <PlayerBar />
    </div>
  );
};
