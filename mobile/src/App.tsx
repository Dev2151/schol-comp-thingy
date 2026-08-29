import React, { useState, useEffect } from 'react';
import Home from './pages/Home';
import Files from './pages/Files';
import AIChat from './pages/AIChat';

type Page = 'home' | 'files' | 'ai';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [relayUrl, setRelayUrl] = useState('');
  const [nodeId, setNodeId] = useState('');

  useEffect(() => {
    // Get relay URL from query params
    const params = new URLSearchParams(window.location.search);
    const node = params.get('node');
    if (node) {
      setNodeId(node);
      // Default relay URL — in production, this would be configurable
      setRelayUrl(params.get('relay') || 'http://localhost:9500');
    }
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <Home relayUrl={relayUrl} nodeId={nodeId} />;
      case 'files':
        return <Files relayUrl={relayUrl} nodeId={nodeId} />;
      case 'ai':
        return <AIChat />;
    }
  };

  return (
    <div className="mobile-app">
      <main className="mobile-content">
        {renderPage()}
      </main>

      <nav className="mobile-nav">
        <button
          className={`nav-btn ${currentPage === 'home' ? 'active' : ''}`}
          onClick={() => setCurrentPage('home')}
        >
          <span className="nav-icon">◉</span>
          <span className="nav-label">Network</span>
        </button>
        <button
          className={`nav-btn ${currentPage === 'files' ? 'active' : ''}`}
          onClick={() => setCurrentPage('files')}
        >
          <span className="nav-icon">📁</span>
          <span className="nav-label">Files</span>
        </button>
        <button
          className={`nav-btn ${currentPage === 'ai' ? 'active' : ''}`}
          onClick={() => setCurrentPage('ai')}
        >
          <span className="nav-icon">🤖</span>
          <span className="nav-label">AI</span>
        </button>
      </nav>
    </div>
  );
}
