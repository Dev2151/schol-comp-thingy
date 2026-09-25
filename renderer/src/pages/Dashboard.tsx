import React, { useEffect, useState } from 'react';

declare global {
  interface Window {
    'title-tbd': any;
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
  const isElectron = typeof window !== 'undefined' && window['title-tbd'] != null;

  useEffect(() => {
    if (!isElectron) return;
    const loadData = async () => {
      try {
        const [nodesList, model, sys] = await Promise.all([
          window['title-tbd'].getConnectedNodes(),
          window['title-tbd'].ollamaStatus(),
          window['title-tbd'].getSystemInfo(),
        ]);
        setNodes(nodesList);
        setSysInfo(sys);
        if (model.running) {
          const models = await window['title-tbd'].ollamaListModels();
          if (models.length > 0) setModelName(models[0].name);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      }
    };
    loadData();
    window['title-tbd'].onNodeUpdate((updatedNodes: NodeInfo[]) => {
      setNodes(updatedNodes);
    });
    return () => { window['title-tbd'].removeNodeListener(); };
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
            <span className="card-title">Cluster nodes</span>
            <span className="card-subtitle">Live — updates as machines join</span>
          </div>
          <div className="recent-list">
            {nodes.length === 0 && (
              <div className="recent-item">
                <div className="recent-item-text">
                  <div className="recent-item-title">No workers connected yet</div>
                  <div className="recent-item-time">Start a worker VM or run COORDINATOR_IP=&lt;host-ip&gt; on another machine</div>
                </div>
              </div>
            )}
            {nodes.map(n => (
              <div className="recent-item" key={n.nodeId}>
                <div className="recent-item-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                  </svg>
                </div>
                <div className="recent-item-text">
                  <div className="recent-item-title">{n.hostname} {n.nodeId ? `(${String(n.nodeId).slice(0, 8)})` : ''}</div>
                  <div className="recent-item-time">{n.ip}:{n.port} · {n.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
