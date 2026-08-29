import React, { useState, useEffect } from 'react';

declare global {
  interface Window {
    title-tbd: any;
  }
}

interface OllamaModel {
  name: string;
  size: number;
}

interface SystemInfo {
  hostname: string;
  totalRam: number;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const demoModels: OllamaModel[] = [
  { name: 'gemma2:2b', size: 1.6 * 1024 * 1024 * 1024 },
  { name: 'gemma2:9b', size: 5.4 * 1024 * 1024 * 1024 },
  { name: 'llama3.2:3b', size: 2.0 * 1024 * 1024 * 1024 },
  { name: 'mistral:7b', size: 4.1 * 1024 * 1024 * 1024 },
  { name: 'phi3:mini', size: 2.2 * 1024 * 1024 * 1024 },
  { name: 'qwen2.5:7b', size: 4.4 * 1024 * 1024 * 1024 },
];

export default function Models() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const isElectron = typeof window !== 'undefined' && window.title-tbd != null;

  useEffect(() => {
    const load = async () => {
      if (!isElectron) {
        setModels(demoModels);
        setSelected('gemma2:2b');
        return;
      }
      const [status, sys] = await Promise.all([
        window.title-tbd.ollamaStatus(),
        window.title-tbd.getSystemInfo(),
      ]);
      setSysInfo(sys);
      if (status.running) {
        const list = await window.title-tbd.ollamaListModels();
        setModels(list);
        if (list.length > 0) setSelected(list[0].name);
      }
    };
    load();
  }, [isElectron]);

  // Real cluster RAM = this machine's RAM (single node for now)
  const clusterRam = sysInfo?.totalRam || 13 * 1024 * 1024 * 1024;

  const getFitClass = (modelSize: number) => {
    const ratio = modelSize / clusterRam;
    if (ratio <= 0.5) return 'fits';
    if (ratio <= 0.85) return 'tight';
    return 'insufficient';
  };

  const getFitLabel = (modelSize: number) => {
    const ratio = modelSize / clusterRam;
    if (ratio <= 0.5) return 'Fits comfortably';
    if (ratio <= 0.85) return 'Tight fit';
    return 'Insufficient RAM';
  };

  const selectedModel = models.find(m => m.name === selected);

  return (
    <div>
      <div className="page-header">
        <h2>Models</h2>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {isElectron && sysInfo ? `${formatSize(clusterRam)} available` : 'Detecting cluster RAM…'}
        </span>
      </div>

      <div className="model-grid" style={{ marginBottom: '24px' }}>
        {models.map(model => (
          <div
            key={model.name}
            className={`model-card ${selected === model.name ? 'selected' : ''}`}
            onClick={() => setSelected(model.name)}
          >
            <div className="model-card-name">{model.name}</div>
            <div className="model-card-meta">
              {model.name.includes('2b') ? '2.6B params' :
               model.name.includes('3b') ? '3.2B params' :
               model.name.includes('7b') ? '7B params' :
               model.name.includes('9b') ? '9B params' : 'Unknown'}
            </div>
            <div className="model-card-size">{formatSize(model.size)}</div>
            <div className="model-fit-bar">
              <div className="model-fit-label">
                <span>{getFitLabel(model.size)}</span>
                <span>{Math.round((model.size / clusterRam) * 100)}% of cluster</span>
              </div>
              <div className="model-fit-bar-track">
                <div
                  className={`model-fit-bar-fill ${getFitClass(model.size)}`}
                  style={{ width: `${Math.min((model.size / clusterRam) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedModel && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Proposed Layer Split</span>
            <button className="btn btn-primary">Distribute and load</button>
          </div>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                {selectedModel.name} will be split proportionally based on each node's available RAM.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ padding: '12px', background: 'var(--bg-input)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {sysInfo?.hostname || 'This PC'}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--accent)' }}>
                    All layers (single node)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
