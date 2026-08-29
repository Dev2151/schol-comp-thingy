import React, { useState, useRef, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    freegrid: any;
  }
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface OllamaModel {
  name: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const ChatIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<{ running: boolean; error?: string }>({ running: false });
  const [streamingText, setStreamingText] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [workerCount, setWorkerCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isElectron = typeof window !== 'undefined' && window.freegrid != null;

  useEffect(() => {
    checkOllama();
    if (isElectron) {
      window.freegrid.getPipelineState().then((state: any) => {
        setWorkerCount(state?.workerLayers?.length || 0);
      }).catch(() => {});
    }
    return () => {
      if (isElectron) window.freegrid.removeStreamListeners();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+N = new chat
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setMessages([]);
        setStreamingText('');
        inputRef.current?.focus();
      }
      // Cmd/Ctrl+K = focus input
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [distributableModels, setDistributableModels] = useState<{ name: string; size: number; totalLayers: number; estimatedSizeGB: string; paramsBillions: number; installed: boolean }[]>([]);

  const checkOllama = async () => {
    if (!isElectron) {
      setOllamaStatus({ running: false, error: 'Browser preview mode — Ollama requires the Electron app.' });
      return;
    }
    const status = await window.freegrid.ollamaStatus();
    setOllamaStatus(status);
    if (status.running) {
      const modelList = await window.freegrid.ollamaListModels();
      setModels(modelList);
      if (modelList.length > 0 && !selectedModel) {
        setSelectedModel(modelList[0].name);
      }
    }
    // Load distributable models (all known models)
    try {
      const distModels = await window.freegrid.getDistributableModels();
      setDistributableModels(distModels);
    } catch {}
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading || !selectedModel) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setStreamingText('');

    if (isElectron) {
      // Set up streaming listeners
      const history = messages.map(m => ({ role: m.role, content: m.content }));

      window.freegrid.onStreamToken((token: string) => {
        setStreamingText(prev => prev + token);
      });

      window.freegrid.onStreamDone((fullText: string) => {
        if (fullText) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: fullText,
            timestamp: new Date(),
          }]);
        }
        setStreamingText('');
        setIsLoading(false);
        window.freegrid.removeStreamListeners();
      });

      window.freegrid.onStreamError((error: string) => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${error}`,
          timestamp: new Date(),
        }]);
        setStreamingText('');
        setIsLoading(false);
        window.freegrid.removeStreamListeners();
      });

      // Check if we have a distributed pipeline active
      const pipelineState = await window.freegrid.getPipelineState();
      const hasWorkers = pipelineState?.workerLayers?.length > 0;

      if (hasWorkers) {
        // Use distributed inference — coordinator + worker(s)
        console.log('[Chat] Using distributed inference across', pipelineState.workerLayers.length + 1, 'nodes');
        await window.freegrid.runDistributedInference(userMessage.content, selectedModel);
      } else {
        // Single node — use local Ollama
        await window.freegrid.ollamaChatStream(selectedModel, userMessage.content, history);
      }
    } else {
      // Browser preview — simulate a response
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'This is a preview response. In the Electron app, this would stream tokens from your local Ollama model in real time.',
          timestamp: new Date(),
        }]);
        setIsLoading(false);
      }, 1500);
    }
  }, [input, isLoading, selectedModel, messages, isElectron]);

  const handleStop = async () => {
    if (isElectron) {
      await window.freegrid.ollamaStopStream();
    }
    // Append whatever we have so far
    if (streamingText) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: streamingText + ' *(stopped)*',
        timestamp: new Date(),
      }]);
    }
    setStreamingText('');
    setIsLoading(false);
    if (isElectron) window.freegrid.removeStreamListeners();
  };

  if (!ollamaStatus.running) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">
          <ChatIcon />
        </div>
        <h3>Ollama is not running</h3>
        <p>{ollamaStatus.error || 'Install Ollama from ollama.com and start it to begin chatting with local models.'}</p>
        <div className="install-instructions">
          <h4>Quick Setup</h4>
          <code>curl -fsSL https://ollama.com/install.sh | sh</code>
          <p>Then pull a model:</p>
          <code>ollama pull gemma2:2b</code>
        </div>
        <button className="btn btn-primary btn-lg" onClick={checkOllama} style={{ marginTop: '24px' }}>
          Check Again
        </button>
      </div>
    );
  }

  const currentModelName = selectedModel.split(':')[0] || selectedModel;

  return (
    <div className="chat-page">
      {/* Model selector bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 40px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              className="model-chip"
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              style={{ fontSize: '13px' }}
            >
              <span className="dot" />
              {currentModelName}
              <ChevronIcon />
            </button>
            {modelDropdownOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '4px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-lg)',
                minWidth: '320px',
                maxHeight: '400px',
                overflowY: 'auto',
                zIndex: 50,
                padding: '4px',
              }}>
                <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Available models
                </div>
                {distributableModels.length > 0 ? distributableModels.map(model => (
                  <button
                    key={model.name}
                    onClick={() => { setSelectedModel(model.name); setModelDropdownOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      background: selectedModel === model.name ? 'var(--accent-light)' : 'transparent',
                      color: model.installed ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderRadius: 'var(--radius-xs)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      textAlign: 'left',
                      opacity: model.installed ? 1 : 0.8,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <span style={{ fontWeight: 500 }}>{model.name}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {model.totalLayers} layers · {model.estimatedSizeGB} GB · {model.paramsBillions}B params{' '}
                        {!model.installed && <span style={{ color: 'var(--warning)' }}>· not installed</span>}
                      </span>
                    </div>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontFamily: 'monospace', flexShrink: 0 }}>
                      {model.installed ? formatSize(model.size) : model.estimatedSizeGB + ' GB'}
                    </span>
                  </button>
                )) : models.map(model => (
                  <button
                    key={model.name}
                    onClick={() => { setSelectedModel(model.name); setModelDropdownOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      background: selectedModel === model.name ? 'var(--accent-light)' : 'transparent',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-xs)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      textAlign: 'left',
                    }}
                  >
                    <span>{model.name}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontFamily: 'monospace' }}>
                      {formatSize(model.size)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {workerCount > 0 && (
            <div className="pipeline-chip" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
              <span className="dot" style={{ background: 'var(--accent)' }} />
              Distributed · {workerCount + 1} nodes
            </div>
          )}
          {isLoading && (
            <div className="pipeline-chip" style={{ cursor: 'pointer' }} onClick={handleStop}>
              <span className="dot" style={{ background: 'var(--warning)' }} />
              Generating…
            </div>
          )}
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            ⌘N new · ⌘K focus
          </span>
        </div>
      </div>

      <div className="chat-messages-area">
        {messages.length === 0 && !streamingText && (
          <div className="chat-empty-state">
            <h3>Ask your local model anything</h3>
            <p>No data leaves your machine. Powered by {currentModelName} across your cluster.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className={`chat-avatar ${msg.role}`}>
              {msg.role === 'user' ? 'Y' : 'AI'}
            </div>
            <div className="chat-bubble">{msg.content}</div>
          </div>
        ))}

        {streamingText && (
          <div className="chat-message assistant">
            <div className="chat-avatar assistant">AI</div>
            <div>
              <div className="chat-bubble">{streamingText}</div>
              <div className="chat-bubble-streaming">Streaming response</div>
            </div>
          </div>
        )}

        {isLoading && !streamingText && (
          <div className="chat-message assistant">
            <div className="chat-avatar assistant">AI</div>
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
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask your local model anything"
            disabled={isLoading && !!streamingText}
          />
          {isLoading ? (
            <button className="chat-send-btn" onClick={handleStop} style={{ background: 'var(--danger)' }}>
              <StopIcon />
            </button>
          ) : (
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
