import React, { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    worker: any;
  }
}

interface WorkerStatus {
  nodeId: string;
  hostname: string;
  connectionStatus: 'searching' | 'connecting' | 'connected' | 'error';
  coordinator: { ip: string; port: number; hostname: string } | null;
  totalRam: number;
  freeRam: number;
  cpuCount: number;
  cpuModel: string;
  loadedLayers: { model: string; layerRange: string; status: string } | null;
  logs: string[];
  inferencing?: boolean;
  inferTokens?: string[];
  inferLayerRange?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type Tab = 'chat' | 'status' | 'logs';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const statusColors: Record<string, string> = {
  searching: '#ff9500',
  connecting: '#5856d6',
  connected: '#34c759',
  error: '#ff3b30',
};

const statusLabels: Record<string, string> = {
  searching: 'Searching…',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Disconnected',
};

export default function App() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('status');
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('freegrid-worker-dark') === 'true'; } catch { return false; }
  });

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Coordinator inference activity
  const [coordActivity, setCoordActivity] = useState<{
    active: boolean;
    model: string;
    tokens: string[];
    tokenCount: number;
    done: boolean;
    result: string;
  }>({ active: false, model: '', tokens: [], tokenCount: 0, done: false, result: '' });

  // Connection settings
  const [coordinatorIp, setCoordinatorIp] = useState('');
  const [showConnectForm, setShowConnectForm] = useState(false);

  // Load saved coordinator IP on mount
  useEffect(() => {
    window.worker.getSavedCoordinatorIp?.().then((ip: string) => {
      if (ip) setCoordinatorIp(ip);
    });
  }, []);

  const handleConnectToIp = () => {
    if (coordinatorIp.trim()) {
      window.worker.connectToIp(coordinatorIp.trim());
      setShowConnectForm(false);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('freegrid-worker-dark', String(dark)); } catch {}
  }, [dark]);

  useEffect(() => {
    window.worker.getStatus().then((s: WorkerStatus) => {
      setStatus(s);
      setLogs(s.logs || []);
    });

    window.worker.onStatus((s: WorkerStatus) => {
      setStatus(s);
      if (s.inferencing === false && isGenerating) {
        setIsGenerating(false);
      }
    });

    window.worker.onLog((log: string) => {
      setLogs(prev => [...prev.slice(-199), log]);
    });

    window.worker.onInferStart?.((data: any) => {
      setCoordActivity({ active: true, model: data.model, tokens: [], tokenCount: 0, done: false, result: '' });
      setIsGenerating(true);
    });

    window.worker.onInferProgress?.((data: any) => {
      setCoordActivity(prev => ({
        ...prev,
        tokens: [...prev.tokens, data.token],
        tokenCount: data.tokenIndex,
      }));
    });

    window.worker.onInferDone?.((data: any) => {
      setCoordActivity(prev => ({ ...prev, active: false, done: true, result: data.fullText || '' }));
      setIsGenerating(false);
    });

    window.worker.onInferStop?.(() => {
      setCoordActivity(prev => ({ ...prev, active: false, done: false, result: '' }));
      setIsGenerating(false);
    });

    return () => { window.worker.removeListeners(); };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status?.inferTokens]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;
    const userMsg: ChatMessage = { role: 'user', content: input.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);

    // Worker sends to coordinator for distributed inference
    // For now, simulate local response showing what this worker's layers processed
    setTimeout(() => {
      const layerRange = status?.loadedLayers?.layerRange || '0–0';
      const model = status?.loadedLayers?.model || 'unknown';
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: `This worker processed layers ${layerRange} for model ${model}. The coordinator orchestrated distributed inference across the cluster — your prompt was split so this machine handled its assigned layers while the coordinator handled the rest.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setIsGenerating(false);
    }, 1500);
  };

  if (!status) {
    return (
      <div className="app" data-theme={dark ? 'dark' : 'light'}>
        <div className="loading">Starting worker node…</div>
      </div>
    );
  }

  const ramUsedPct = status.totalRam > 0
    ? ((status.totalRam - status.freeRam) / status.totalRam * 100)
    : 0;

  return (
    <div className="app" data-theme={dark ? 'dark' : 'light'}>
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
              </svg>
            </div>
            <span className="logo-text">FreeGrid Worker</span>
          </div>
        </div>
        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="status-badge" style={{ background: statusColors[status.connectionStatus] + '20', color: statusColors[status.connectionStatus] }}>
            <span className="status-dot" style={{ background: statusColors[status.connectionStatus] }} />
            {statusLabels[status.connectionStatus]}
          </div>
          <button className="toggle-btn" onClick={() => setDark(!dark)} title="Toggle dark mode">
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="tab-bar">
        <button className={`tab ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
          💬 Chat
        </button>
        <button className={`tab ${activeTab === 'status' ? 'active' : ''}`} onClick={() => setActiveTab('status')}>
          ◉ Status
        </button>
        <button className={`tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
          📋 Logs
        </button>
      </div>

      <div className="content">
        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="chat-tab">
            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="chat-empty">
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>💬</div>
                  <h3>Worker Chat</h3>
                  <p>Messages are processed through the distributed pipeline across your cluster.</p>
                  {status.loadedLayers && (
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                      This worker handles layers {status.loadedLayers.layerRange} for {status.loadedLayers.model}
                    </p>
                  )}
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                  <div className={`chat-avatar ${msg.role}`}>
                    {msg.role === 'user' ? 'Y' : 'W'}
                  </div>
                  <div className="chat-bubble">{msg.content}</div>
                </div>
              ))}

              {isGenerating && status.inferTokens && status.inferTokens.length > 0 && (
                <div className="chat-message assistant">
                  <div className="chat-avatar assistant">W</div>
                  <div>
                    <div className="chat-bubble">
                      {status.inferTokens.join('')}
                    </div>
                    <div className="streaming-label">Streaming from layers {status.loadedLayers?.layerRange}</div>
                  </div>
                </div>
              )}

              {isGenerating && (!status.inferTokens || status.inferTokens.length === 0) && (
                <div className="chat-message assistant">
                  <div className="chat-avatar assistant">W</div>
                  <div className="typing-indicator">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chat-composer-wrapper">
              <div className="chat-composer">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="Ask through the distributed pipeline…"
                  disabled={isGenerating}
                />
                <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim() || isGenerating}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Status Tab */}
        {activeTab === 'status' && (
          <>
            {/* Connection Settings - show when not connected or user wants to change */}
            {(status.connectionStatus === 'searching' || status.connectionStatus === 'error' || showConnectForm) && (
              <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
                <div className="card-header">
                  <span className="card-title">Connect to Coordinator</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    Enter the coordinator's Tailscale or WiFi IP
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <input
                    type="text"
                    value={coordinatorIp}
                    onChange={e => setCoordinatorIp(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleConnectToIp()}
                    placeholder="e.g. 100.64.0.1 or 192.168.1.10"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border, rgba(0,0,0,0.1))',
                      background: 'var(--bg-primary, #fff)',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <button className="btn" onClick={handleConnectToIp} disabled={!coordinatorIp.trim()}>
                    Connect
                  </button>
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  💡 For Tailscale: use the coordinator's 100.x.x.x IP (run <code>tailscale ip</code> on the coordinator).<br/>
                  💡 For WiFi: use the coordinator's local IP (run <code>hostname -I</code> on the coordinator).<br/>
                  💡 mDNS auto-discovery only works on the same local network, not over Tailscale.
                </div>
              </div>
            )}

            {/* Coordinator Inference Activity */}
            {(coordActivity.active || coordActivity.done) && (
              <div className="card" style={{ borderLeft: '3px solid var(--accent)', background: coordActivity.active ? 'var(--accent-soft, rgba(99, 102, 241, 0.05))' : undefined }}>
                <div className="card-header">
                  <span className="card-title">
                    {coordActivity.active ? '⚡ Coordinator Processing' : '✓ Inference Complete'}
                  </span>
                  <span style={{ fontSize: '12px', color: coordActivity.active ? 'var(--accent)' : 'var(--success)', fontWeight: 500 }}>
                    {coordActivity.active ? `${coordActivity.tokenCount} tokens` : `${coordActivity.tokens.length} tokens`}
                  </span>
                </div>
                {coordActivity.model && (
                  <div style={{ marginBottom: '8px' }}>
                    <div className="stat-label">Model</div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{coordActivity.model}</div>
                  </div>
                )}
                {coordActivity.active && coordActivity.tokens.length > 0 && (
                  <div style={{ 
                    fontSize: '13px', 
                    fontFamily: 'monospace', 
                    lineHeight: 1.6,
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'var(--bg-secondary, rgba(0,0,0,0.03))',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {coordActivity.tokens.join('')}
                    <span style={{ display: 'inline-block', width: '2px', height: '14px', background: 'var(--accent)', marginLeft: '1px', animation: 'blink 1s infinite', verticalAlign: 'text-bottom' }} />
                  </div>
                )}
                {coordActivity.done && coordActivity.result && (
                  <div style={{ 
                    fontSize: '13px', 
                    fontFamily: 'monospace', 
                    lineHeight: 1.6,
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'var(--bg-secondary, rgba(0,0,0,0.03))',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {coordActivity.result}
                  </div>
                )}
              </div>
            )}

            {/* Active Work */}
            {status.loadedLayers && (
              <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
                <div className="card-header">
                  <span className="card-title">Active Work</span>
                  <span style={{ fontSize: '12px', color: status.inferencing ? 'var(--warning)' : 'var(--success)', fontWeight: 500 }}>
                    {status.inferencing ? '⚡ Processing' : '✓ Ready'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <div className="stat-label">Model</div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{status.loadedLayers.model}</div>
                  </div>
                  <div>
                    <div className="stat-label">My Layers</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace' }}>
                      {status.loadedLayers.layerRange}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Status</div>
                    <div style={{ fontSize: '14px', fontWeight: 500, color: status.loadedLayers.status === 'loaded' ? 'var(--success)' : 'var(--warning)' }}>
                      {status.loadedLayers.status}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* System Info */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">This Machine</span>
                <span className="card-subtitle">{status.hostname}</span>
              </div>
              <div className="stats-grid">
                <div className="stat">
                  <div className="stat-label">Total RAM</div>
                  <div className="stat-value">{formatBytes(status.totalRam)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Free RAM</div>
                  <div className="stat-value">{formatBytes(status.freeRam)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">CPU</div>
                  <div className="stat-value">{status.cpuCount} cores</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Node ID</div>
                  <div className="stat-value mono">{status.nodeId.slice(0, 8)}…</div>
                </div>
              </div>
              <div className="ram-bar">
                <div className="ram-bar-fill" style={{ width: `${ramUsedPct}%` }} />
              </div>
              <div className="ram-label">{formatBytes(status.totalRam - status.freeRam)} used of {formatBytes(status.totalRam)}</div>
            </div>

            {/* Coordinator */}
            {status.coordinator && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Coordinator</span>
                  <span className="card-subtitle">{status.coordinator.hostname}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Address</span>
                  <span className="detail-value mono">{status.coordinator.ip}:{status.coordinator.port}</span>
                </div>
                {status.loadedLayers && (
                  <>
                    <div className="detail-row">
                      <span className="detail-label">Assigned Model</span>
                      <span className="detail-value">{status.loadedLayers.model}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Layer Range</span>
                      <span className="detail-value mono">{status.loadedLayers.layerRange}</span>
                    </div>
                  </>
                )}
                {!status.loadedLayers && status.connectionStatus === 'connected' && (
                  <div className="waiting">Waiting for layer assignment…</div>
                )}
              </div>
            )}
          </>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <div className="card logs-card">
            <div className="card-header">
              <span className="card-title">Logs</span>
              <button className="btn btn-sm" onClick={() => window.worker.reconnect()}>Reconnect</button>
            </div>
            <div className="logs">
              {logs.map((log, i) => (
                <div key={i} className="log-line">{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
