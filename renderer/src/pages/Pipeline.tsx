import React, { useEffect, useState } from 'react';

declare global {
  interface Window {
    freegrid: any;
  }
}

interface PipelineState {
  model: { name: string; totalLayers: number; estimatedSizeBytes: number } | null;
  assignments: {
    nodeId: string;
    hostname: string;
    layerStart: number;
    layerEnd: number;
    layerCount: number;
    freeRam: number;
    totalRam: number;
  }[];
  activeWorkers: string[];
  coordinatorLayers: any;
  workerLayers: any[];
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

export default function Pipeline() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemma2:2b');
  const isElectron = typeof window !== 'undefined' && window.freegrid != null;

  useEffect(() => {
    if (!isElectron) return;
    const load = async () => {
      const [sys, state] = await Promise.all([
        window.freegrid.getSystemInfo(),
        window.freegrid.getPipelineState(),
      ]);
      setSysInfo(sys);
      setPipelineState(state);
    };
    load();
  }, [isElectron]);

  const handleAssignLayers = async () => {
    setIsAssigning(true);
    try {
      if (isElectron) {
        const result = await window.freegrid.assignModelLayers(selectedModel);
        const state = await window.freegrid.getPipelineState();
        setPipelineState(state);
      } else {
        // Browser preview — simulate layer split
        const modelInfo: Record<string, { layers: number; sizeGB: number }> = {
          'gemma2:2b': { layers: 26, sizeGB: 1.6 },
          'gemma2:9b': { layers: 42, sizeGB: 5.4 },
          'llama3.1:8b': { layers: 32, sizeGB: 4.7 },
          'mistral:7b': { layers: 32, sizeGB: 4.1 },
        };
        const info = modelInfo[selectedModel] || { layers: 26, sizeGB: 1.6 };
        const totalLayers = info.layers;
        const coordLayers = Math.ceil(totalLayers * 0.47);
        const workerLayers = totalLayers - coordLayers;

        setPipelineState({
          model: { name: selectedModel, totalLayers, estimatedSizeBytes: info.sizeGB * 1024**3 },
          assignments: [
            {
              nodeId: 'coordinator',
              hostname: sysInfo?.hostname || 'This PC',
              layerStart: 0,
              layerEnd: coordLayers - 1,
              layerCount: coordLayers,
              freeRam: sysInfo?.freeRam || 9 * 1024**3,
              totalRam: sysInfo?.totalRam || 13.5 * 1024**3,
            },
            {
              nodeId: 'worker-1',
              hostname: 'Worker PC',
              layerStart: coordLayers,
              layerEnd: totalLayers - 1,
              layerCount: workerLayers,
              freeRam: 8 * 1024**3,
              totalRam: 16 * 1024**3,
            },
          ],
          activeWorkers: ['worker-1'],
          coordinatorLayers: null,
          workerLayers: [],
        });
      }
    } catch (err) {
      console.error('Failed to assign layers:', err);
    }
    setIsAssigning(false);
  };

  const hostname = sysInfo?.hostname || 'This PC';
  const assignments = pipelineState?.assignments || [];
  const model = pipelineState?.model;
  const coordinator = assignments.find(a => a.nodeId === 'coordinator');
  const workers = assignments.filter(a => a.nodeId !== 'coordinator');
  const hasSplit = assignments.length > 1;

  return (
    <div>
      <div className="page-header">
        <h2>Pipeline</h2>
        {hasSplit && (
          <div className="pipeline-chip">
            <span className="dot" />
            {assignments.length} nodes active
          </div>
        )}
        {!hasSplit && (
          <div className="pipeline-chip" style={{ background: 'var(--bg-input)', color: 'var(--text-tertiary)' }}>
            <span className="dot" style={{ background: 'var(--text-tertiary)' }} />
            Single node
          </div>
        )}
      </div>

      {/* Model Selection & Layer Assignment */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <span className="card-title">Layer Distribution</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="select"
              style={{ fontSize: '13px' }}
            >
              <option value="gemma2:2b">gemma2:2b (26 layers, 1.6 GB)</option>
              <option value="gemma2:9b">gemma2:9b (42 layers, 5.4 GB)</option>
              <option value="llama3.1:8b">llama3.1:8b (32 layers, 4.7 GB)</option>
              <option value="mistral:7b">mistral:7b (32 layers, 4.1 GB)</option>
            </select>
            <button
              className="btn btn-primary"
              onClick={handleAssignLayers}
              disabled={isAssigning}
            >
              {isAssigning ? 'Assigning…' : 'Distribute Layers'}
            </button>
          </div>
        </div>

        {/* Layer visualization */}
        <div className="pipeline-flow">
          {assignments.length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '32px',
              color: 'var(--text-tertiary)',
              fontSize: '14px',
            }}>
              Select a model and click "Distribute Layers" to split the workload across your nodes.
            </div>
          )}

          {assignments.map((a, i) => (
            <React.Fragment key={a.nodeId}>
              <div className="pipeline-node">
                <div className={`pipeline-node-box ${a.nodeId === 'coordinator' ? 'active' : ''}`}>
                  <div className="pipeline-node-name">{a.hostname}</div>
                  <div className="pipeline-node-role">{a.nodeId === 'coordinator' ? 'Coordinator' : 'Worker'}</div>
                  <div className="pipeline-node-layers">
                    Layers {a.layerStart}–{a.layerEnd}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    marginTop: '4px',
                  }}>
                    {a.layerCount} layers · {formatBytes(a.freeRam)} free
                  </div>
                </div>
              </div>
              {i < assignments.length - 1 && (
                <div className="pipeline-connector active">
                  <span className="pipeline-latency">~80 ms</span>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {hasSplit && model && (
          <div style={{
            textAlign: 'center',
            padding: '12px',
            background: 'var(--success-light)',
            borderRadius: 'var(--radius-sm)',
            marginTop: '16px',
            fontSize: '13px',
            color: 'var(--success)',
            fontWeight: 500,
          }}>
            {model.name} split across {assignments.length} nodes — {model.totalLayers} layers total
          </div>
        )}
      </div>

      {/* Pipeline Details */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Pipeline Details</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Nodes</div>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{assignments.length || 1}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {hasSplit ? `${coordinator?.hostname || 'Coordinator'} + ${workers.length} worker(s)` : 'Single machine'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Latency</div>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{hasSplit ? '~80 ms' : '~0 ms'}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {hasSplit ? 'Network hop between nodes' : 'No network hops'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Health</div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--success)' }}>Healthy</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {hasSplit ? 'All nodes responding' : 'Running locally'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
