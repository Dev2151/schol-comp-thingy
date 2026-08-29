import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelProgress, setModelProgress] = useState('Loading AI model...');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initModel();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initModel = async () => {
    try {
      setModelStatus('loading');
      setModelProgress('Loading AI model... (first time may take a minute)');

      // Dynamic import of transformers.js
      const { pipeline } = await import('@huggingface/transformers');

      setModelProgress('Downloading model (~300MB)...');

      // Use a small model that works well on mobile
      const generator = await pipeline('text-generation', 'Qwen/Qwen2-0.5B-Instruct', {
        // @ts-ignore
        progress_callback: (progress: any) => {
          if (progress.status === 'downloading') {
            const pct = progress.progress ? Math.round(progress.progress) : 0;
            setModelProgress(`Downloading model... ${pct}%`);
          } else if (progress.status === 'loading') {
            setModelProgress('Loading model into memory...');
          }
        },
      });

      // Store the pipeline globally for use in chat
      (window as any).__title-tbd_generator = generator;
      setModelStatus('ready');
      setModelProgress('');
    } catch (err: any) {
      console.error('Failed to load model:', err);
      setModelStatus('error');
      setModelProgress(`Failed to load model: ${err.message}`);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || modelStatus !== 'ready') return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const generator = (window as any).__title-tbd_generator;

      const result = await generator(
        [
          { role: 'system', content: 'You are a helpful assistant running locally on a mobile device. Be concise and helpful.' },
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage.content },
        ],
        {
          max_new_tokens: 256,
          temperature: 0.7,
        }
      );

      const response = result[0]?.generated_text?.slice(-1)?.content || 'No response generated.';

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: response,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="page chat-page">
      <div className="page-header">
        <h2>AI Chat</h2>
        <div className={`status-badge ${modelStatus}`}>
          {modelStatus === 'ready' ? '● Local AI' : modelStatus === 'loading' ? '◌ Loading...' : '○ Error'}
        </div>
      </div>

      {modelStatus === 'loading' && (
        <div className="model-loading">
          <div className="loading-spinner" />
          <p>{modelProgress}</p>
        </div>
      )}

      {modelStatus === 'error' && (
        <div className="error-banner">
          {modelProgress}
          <button className="btn btn-sm btn-primary" onClick={initModel} style={{ marginTop: 12 }}>
            Retry
          </button>
        </div>
      )}

      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && modelStatus === 'ready' && (
            <div className="chat-empty">
              <p>Ask me anything!</p>
              <p className="chat-hint">This runs entirely on your phone — no data sent to the cloud.</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-content">
                <div className="message-text">{msg.content}</div>
                <div className="message-time">
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat-message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span>●</span><span>●</span><span>●</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            className="chat-input"
            disabled={isLoading || modelStatus !== 'ready'}
          />
          <button
            className="btn btn-primary btn-send"
            onClick={handleSend}
            disabled={isLoading || !input.trim() || modelStatus !== 'ready'}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
