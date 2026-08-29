import React, { useEffect, useState } from 'react';

declare global {
  interface Window {
    title-tbd: any;
  }
}

interface NodeInfo {
  nodeId: string;
  hostname: string;
  ip: string;
  port: number;
  status: 'online' | 'offline';
  nodeType: 'desktop' | 'mobile';
}

interface SystemInfo {
  hostname: string;
  totalRam: number;
  freeRam: number;
  cpuCount: number;
  cpuModel: string;
  platform: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [modelName, setModelName] = useState<string>('None');
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const isElectron = typeof window !== 'undefined' && window.title-tbd != null;

  useEffect(() => {
    if (!isElectron) return;
    const loadData = async () => {
      try {
        const [nodesList, model, sys] = await Promise.all([
          window.title-tbd.getConnectedNodes(),
          window.title-tbd.ollamaStatus(),
          window.title-tbd.getSystemInfo(),
        ]);
        setNodes(nodesList);
        setSysInfo(sys);
        if (model.running) {
          const models = await window.title-tbd.ollamaListModels();
          if (models.length > 0) setModelName(models[0].name);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      }
    };
    loadData();
    window.title-tbd.onNodeUpdate((updatedNodes: NodeInfo[]) => {
      setNodes(updatedNodes);
    });
    return () => { window.title-tbd.removeNodeListener(); };
  }, [isElectron]);

  const onlineNodes = isElectron ? nodes.filter(n => n.status === 'online').length : 1;
  const totalRam = sysInfo?.totalRam || 0;
  const freeRam = sysInfo?.freeRam || 0;

  return (
    <div>
      <div className="page-greeting">
        <h1>{getGreeting()}</h1>
        <p>Your local AI cluster is ready.</p>
      </div>

      {!isElectron && (
        <div className="browser-notice">
          Running in browser preview mode. Start the Electron app for full functionality.
        </div>
      )}

      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-card-label">Cluster Health</div>
          <div className="summary-card-value">{isElectron ? onlineNodes : 1} node{onlineNodes !== 1 ? 's' : ''} online</div>
          <div className="summary-card-detail">
            <span className="dot green" />
            {isElectron && sysInfo ? `${formatBytes(freeRam)} free of ${formatBytes(totalRam)}` : 'Detecting RAM…'}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Model Allocation</div>
          <div className="summary-card-value">{modelName}</div>
          <div className="summary-card-detail">
            <span className="dot blue" />
            Layers distributed automatically
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">This Machine</div>
          <div className="summary-card-value">{isElectron && sysInfo ? formatBytes(totalRam) : '—'}</div>
          <div className="summary-card-detail">
            <span className="dot green" />
            {isElectron && sysInfo ? `${sysInfo.cpuCount} cores · ${sysInfo.platform}` : 'System info unavailable'}
          </div>
        </div>
      </div>

      <div className="dashboard-layout">
        <div className="card full-width">
          <div className="card-header">
            <span className="card-title">Continue a conversation</span>
            <button className="btn btn-sm btn-secondary">+ New chat</button>
          </div>
          <div className="recent-list">
            <div className="recent-item">
              <div className="recent-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="recent-item-text">
                <div className="recent-item-title">Explain how pipeline parallelism works for LLM inference</div>
                <div className="recent-item-time">Today, 2:30 PM</div>
              </div>
            </div>
            <div className="recent-item">
              <div className="recent-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="recent-item-text">
                <div className="recent-item-title">Write a Python script to measure inter-node latency</div>
                <div className="recent-item-time">Yesterday, 4:15 PM</div>
              </div>
            </div>
            <div className="recent-item">
              <div className="recent-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="recent-item-text">
                <div className="recent-item-title">What model would work best for 3 nodes with 8GB each?</div>
                <div className="recent-item-time">Monday, 11:00 AM</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
