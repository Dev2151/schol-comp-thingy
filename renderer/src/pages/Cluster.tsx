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
  storageOffered: number;
  storageUsed: number;
  freeRam?: number;
  totalRam?: number;
}

interface SystemInfo {
  hostname: string;
  totalRam: number;
  freeRam: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function Cluster() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [modelName] = useState<string>('gemma2:2b');
  const isElectron = typeof window !== 'undefined' && window.title-tbd != null;

  useEffect(() => {
    if (!isElectron) return;
    const loadData = async () => {
      try {
        const [nodesList, sys] = await Promise.all([
          window.title-tbd.getConnectedNodes(),
          window.title-tbd.getSystemInfo(),
        ]);
        setNodes(nodesList);
        setSysInfo(sys);
      } catch (err) {
        console.error('Failed to load cluster data:', err);
      }
    };
    loadData();
    window.title-tbd.onNodeUpdate((updatedNodes: NodeInfo[]) => {
      setNodes(updatedNodes);
    });
    return () => { window.title-tbd.removeNodeListener(); };
  }, [isElectron]);

  // Use real data from nodes, or sysInfo for this PC
  const thisNodeRam = sysInfo ? { total: sysInfo.totalRam, free: sysInfo.freeRam } : null;

  // Real nodes from network discovery + this PC from system info
  const displayNodes = isElectron && nodes.length > 0
    ? nodes.map((n, i) => ({
        ...n,
        totalRam: i === 0 && thisNodeRam ? thisNodeRam.total : (n.totalRam || n.storageOffered),
        freeRam: i === 0 && thisNodeRam ? thisNodeRam.free : (n.freeRam || n.storageOffered - n.storageUsed),
      }))
    : [
        { nodeId: '1', hostname: sysInfo?.hostname || 'This PC', ip: '192.168.1.41', port: 9501, status: 'online' as const, nodeType: 'desktop' as const, storageOffered: 0, storageUsed: 0, totalRam: thisNodeRam?.total || 0, freeRam: thisNodeRam?.free || 0 },
      ];

  const totalClusterRam = isElectron && sysInfo ? sysInfo.totalRam : 0;
  const freeClusterRam = isElectron && sysInfo ? sysInfo.freeRam : 0;

  return (
    <div>
      <div className="page-header">
        <h2>Cluster</h2>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {formatBytes(freeClusterRam)} free of {formatBytes(totalClusterRam)} total
        </span>
        <button className="btn btn-secondary">Refresh</button>
      </div>

      <div className="card">
        <table className="cluster-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Role</th>
              <th>IP Address</th>
              <th>Free / Total RAM</th>
              <th>Model</th>
              <th>Layers</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayNodes.map((node, i) => {
              const freeGB = node.freeRam || 0;
              const totalGB = node.totalRam || 0;
              const usedPct = totalGB > 0 ? ((totalGB - freeGB) / totalGB) * 100 : 0;
              return (
                <tr key={node.nodeId} style={i === 0 ? { background: 'var(--accent-light)' } : {}}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                      </div>
                      <span style={{ fontWeight: 500 }}>{node.hostname}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`node-role-badge ${i === 0 ? 'coordinator' : 'worker'}`}>
                      {i === 0 ? 'Coordinator' : 'Worker'}
                    </span>
                  </td>
                  <td className="mono">{node.ip}:{node.port}</td>
                  <td>
                    <div>{formatBytes(freeGB)} / {formatBytes(totalGB)}</div>
                    <div className="ram-bar" style={{ width: '80px', marginTop: '4px' }}>
                      <div
                        className={`ram-bar-fill ${usedPct > 85 ? 'high' : usedPct > 60 ? 'medium' : ''}`}
                        style={{ width: `${usedPct}%` }}
                      />
                    </div>
                  </td>
                  <td className="mono">{modelName}</td>
                  <td className="mono">{i === 0 ? '0–11' : '12–23'}</td>
                  <td>
                    <div className="node-status">
                      <span className={`dot ${node.status === 'online' ? 'ready' : 'offline'}`} />
                      {node.status === 'online' ? 'Ready' : 'Offline'}
                    </div>
                  </td>
                  <td>
                    {i === 0 ? (
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>This PC</span>
                    ) : (
                      <button className="btn btn-sm btn-ghost">Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
