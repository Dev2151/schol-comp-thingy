import React, { useState, useEffect, createContext, useContext } from 'react';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Cluster from './pages/Cluster';
import Pipeline from './pages/Pipeline';
import Models from './pages/Models';
import Settings from './pages/Settings';

declare global {
  interface Window {
    title-tbd: any;
  }
}

type Page = 'chat' | 'dashboard' | 'cluster' | 'pipeline' | 'models' | 'settings';

export const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });

const isElectron = typeof window !== 'undefined' && window.title-tbd != null;

function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const icons = {
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  dashboard: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  cluster: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  pipeline: 'M4 12h4m4 0h4M4 6h16M4 18h16',
  models: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
  grid: 'M3 3h7v7H3V3zM14 3h7v7h-7V3zM14 14h7v7h-7v-7zM3 14h7v7H3v-7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('title-tbd-dark') === 'true'; } catch { return false; }
  });
  const [sysInfo, setSysInfo] = useState<{ hostname: string; totalRam: number; freeRam: number } | null>(null);

  useEffect(() => {
    if (!isElectron) return;
    window.title-tbd.getSystemInfo().then((info: any) => setSysInfo(info));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('title-tbd-dark', String(dark)); } catch {}
  }, [dark]);

  const toggleDark = () => setDark(d => !d);

  const renderPage = () => {
    switch (currentPage) {
      case 'chat': return <Chat />;
      case 'dashboard': return <Dashboard />;
      case 'cluster': return <Cluster />;
      case 'pipeline': return <Pipeline />;
      case 'models': return <Models />;
      case 'settings': return <Settings />;
    }
  };

  const navItems: { id: Page; icon: string; label: string }[] = [
    { id: 'chat', icon: icons.chat, label: 'Chat' },
    { id: 'dashboard', icon: icons.dashboard, label: 'Overview' },
    { id: 'cluster', icon: icons.grid, label: 'Cluster' },
    { id: 'pipeline', icon: icons.pipeline, label: 'Pipeline' },
    { id: 'models', icon: icons.models, label: 'Models' },
    { id: 'settings', icon: icons.settings, label: 'Settings' },
  ];

  return (
    <ThemeContext.Provider value={{ dark, toggle: toggleDark }}>
      <div className="app">
        <nav className="nav-rail">
          <div className="nav-brand">
            <div className="nav-brand-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
              </svg>
            </div>
          </div>

          <div className="nav-items">
            {navItems.map(item => (
              <button
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => setCurrentPage(item.id)}
                title={item.label}
              >
                <NavIcon d={item.icon} />
                {item.id === 'cluster' && isElectron && (
                  <span className="nav-badge" />
                )}
              </button>
            ))}
          </div>

          <div className="nav-footer">
            <span className="nav-version">v0.2.0</span>
          </div>
        </nav>

        <div className="main-area">
          <div className="global-status">
            <div className="status-indicator">
              <span className="status-dot" />
              <span>Ready to chat</span>
            </div>
            <div className="status-divider" />
            <div className="status-item">
              Active model: <strong>gemma2:2b</strong>
            </div>
            <div className="status-divider" />
          <div className="status-item">
            <strong>{sysInfo ? '1' : '—'} node{sysInfo ? '' : ''}</strong> online
          </div>
            <div className="status-divider" />
            <div className="status-item">
              Coordinator: <strong>This PC</strong>
            </div>
            <button
              className="status-action"
              onClick={() => setCurrentPage('cluster')}
            >
              View cluster
            </button>
          </div>

          <div className="workspace">
            <div className="content">
              {renderPage()}
            </div>

            {currentPage === 'dashboard' && (
              <div className="detail-panel">
                <div className="card-header">
                  <span className="card-title">Cluster at a glance</span>
                </div>
                <div className="node-list">
                  <div className="node-row current">
                    <div className="node-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </div>
                    <div className="node-info">
                      <div className="node-name">
                        {sysInfo?.hostname || 'This PC'}
                        <span className="node-role-badge coordinator">Coordinator</span>
                      </div>
                      <div className="node-meta">{sysInfo ? `${formatBytes(sysInfo.freeRam)} free` : 'Detecting…'}</div>
                    </div>
                    <div className="node-status">
                      <span className="dot ready" />
                      Ready
                    </div>
                  </div>
                </div>

                <button
                  className="card-action"
                  style={{ marginTop: '16px', width: '100%', textAlign: 'center' }}
                  onClick={() => setCurrentPage('pipeline')}
                >
                  Open pipeline →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ThemeContext.Provider>
  );
}
