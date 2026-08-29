import React, { useEffect, useState } from 'react';

interface NodeInfo {
  nodeId: string;
  hostname: string;
  ip: string;
  port: number;
  storageOffered: number;
  storageUsed: number;
  status: string;
  nodeType: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface HomeProps {
  relayUrl: string;
  nodeId: string;
}

export default function Home({ relayUrl, nodeId }: HomeProps) {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!relayUrl) return;

    const fetchNodes = async () => {
      try {
        const response = await fetch(`${relayUrl}/nodes`);
        if (response.ok) {
          const data = await response.json() as any;
          setNodes(data.nodes || []);
          setConnected(true);
          setError('');
        }
      } catch (err: any) {
        setError('Cannot connect to relay server');
        setConnected(false);
      }
    };

    fetchNodes();
    const interval = setInterval(fetchNodes, 5000);

    return () => clearInterval(interval);
  }, [relayUrl]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Network</h2>
        <div className={`status-badge ${connected ? 'online' : 'offline'}`}>
          {connected ? '● Connected' : '○ Disconnected'}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {!relayUrl ? (
        <div className="empty-state">
          <div className="empty-icon">📱</div>
          <h3>No relay server configured</h3>
          <p>Scan a QR code from a desktop node to connect.</p>
        </div>
      ) : (
        <>
          <div className="stats-row">
            <div className="stat-pill">
              <span className="stat-value">{nodes.length}</span>
              <span className="stat-label">Nodes</span>
            </div>
            <div className="stat-pill">
              <span className="stat-value">
                {formatBytes(nodes.reduce((sum, n) => sum + n.storageOffered, 0))}
              </span>
              <span className="stat-label">Total Storage</span>
            </div>
          </div>

          <div className="node-list">
            {nodes.map(node => (
              <div key={node.nodeId} className={`node-card ${node.status}`}>
                <div className="node-header">
                  <div className={`status-dot ${node.status}`} />
                  <span className="node-name">{node.hostname}</span>
                  <span className="node-type">{node.nodeType}</span>
                </div>
                <div className="node-meta">
                  <span>{node.ip}:{node.port}</span>
                  <span>{formatBytes(node.storageUsed)} / {formatBytes(node.storageOffered)}</span>
                </div>
              </div>
            ))}
          </div>

          {nodes.length === 0 && connected && (
            <div className="empty-state">
              <p>No other nodes online yet</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
