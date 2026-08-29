// ============================================================
// Title TBD — Distributed Inference Pipeline
// Splits model layers across coordinator + workers based on RAM
// ============================================================

import * as os from 'os';
import * as net from 'net';

const RESERVED_RAM = 6 * 1024 * 1024 * 1024; // 6 GB reserved for coordinator OS/apps

export interface NodeAssignment {
  nodeId: string;
  hostname: string;
  ip: string;
  port: number;
  totalRam: number;
  freeRam: number;
  layerStart: number;
  layerEnd: number;
  layerCount: number;
}

export interface ModelInfo {
  name: string;
  totalLayers: number;
  estimatedSizeBytes: number;
  paramsBillions: number;
}

// Known model layer counts and sizes
const MODEL_DB: Record<string, { layers: number; sizeGB: number; params: number }> = {
  'gemma2:2b':  { layers: 26, sizeGB: 1.6, params: 2.6 },
  'gemma2:9b':  { layers: 42, sizeGB: 5.4, params: 9.0 },
  'gemma2:27b': { layers: 46, sizeGB: 16,  params: 27 },
  'llama3.2:3b':  { layers: 28, sizeGB: 2.0, params: 3.2 },
  'llama3.1:8b':  { layers: 32, sizeGB: 4.7, params: 8.0 },
  'llama3.1:70b': { layers: 80, sizeGB: 40,  params: 70 },
  'mistral:7b':   { layers: 32, sizeGB: 4.1, params: 7.0 },
  'mistral:13b':  { layers: 40, sizeGB: 7.4, params: 13 },
  'qwen2.5:7b':   { layers: 28, sizeGB: 4.4, params: 7.0 },
  'phi3:mini':     { layers: 32, sizeGB: 2.2, params: 3.8 },
};

/**
 * Get model info from name.
 */
export function getModelInfo(modelName: string): ModelInfo | null {
  const key = Object.keys(MODEL_DB).find(k => modelName.startsWith(k.split(':')[0]) && modelName.includes(':'));
  if (!key) {
    // Try partial match
    for (const k of Object.keys(MODEL_DB)) {
      if (modelName.includes(k.split(':')[0])) {
        const db = MODEL_DB[k];
        return { name: modelName, totalLayers: db.layers, estimatedSizeBytes: db.sizeGB * 1024**3, paramsBillions: db.params };
      }
    }
    return null;
  }
  const db = MODEL_DB[key];
  return { name: modelName, totalLayers: db.layers, estimatedSizeBytes: db.sizeGB * 1024**3, paramsBillions: db.params };
}

/**
 * Calculate how much RAM is available for model layers on this machine.
 */
export function getAvailableForModel(): number {
  return Math.max(0, os.freemem() - RESERVED_RAM);
}

/**
 * Calculate total cluster RAM available for model layers.
 * Coordinator keeps RESERVED_RAM for itself, workers give most of their free RAM.
 */
export function calculateLayerSplit(
  model: ModelInfo,
  coordinatorRam: number,
  workerNodes: { nodeId: string; hostname: string; ip: string; port: number; freeRam: number }[]
): NodeAssignment[] {
  const assignments: NodeAssignment[] = [];

  // Coordinator's available RAM for model
  const coordAvailable = Math.max(0, coordinatorRam - RESERVED_RAM);
  const coordTotalForModel = coordAvailable;

  // Workers' available RAM (they reserve less — they're dedicated workers)
  const workerReserve = 1 * 1024 * 1024 * 1024; // Workers reserve 1GB for OS
  const workersAvailable = workerNodes.map(w => ({
    ...w,
    available: Math.max(0, w.freeRam - workerReserve),
  }));

  // Total available across cluster
  const totalAvailable = coordTotalForModel + workersAvailable.reduce((s, w) => s + w.available, 0);

  // If model doesn't fit, we can't split it
  if (model.estimatedSizeBytes > totalAvailable * 0.95) {
    console.log(`[Pipeline] Model ${model.name} (${(model.estimatedSizeBytes / 1024**3).toFixed(1)} GB) exceeds cluster capacity (${(totalAvailable / 1024**3).toFixed(1)} GB)`);
    // Still assign what we can — will run partially
  }

  const totalLayers = model.totalLayers;

  // Distribute layers proportionally by available RAM
  const totalRam = coordTotalForModel + workersAvailable.reduce((s, w) => s + w.available, 0);

  if (totalRam === 0) {
    // No RAM available — assign all layers to coordinator
    assignments.push({
      nodeId: 'coordinator',
      hostname: os.hostname(),
      ip: '127.0.0.1',
      port: 9501,
      totalRam: coordinatorRam,
      freeRam: coordAvailable,
      layerStart: 0,
      layerEnd: totalLayers - 1,
      layerCount: totalLayers,
    });
    return assignments;
  }

  let currentLayer = 0;

  // Coordinator layers (proportional to its RAM share)
  const coordShare = coordTotalForModel / totalRam;
  const coordLayers = Math.max(1, Math.round(totalLayers * coordShare));

  assignments.push({
    nodeId: 'coordinator',
    hostname: os.hostname(),
    ip: '127.0.0.1',
    port: 9501,
    totalRam: coordinatorRam,
    freeRam: coordAvailable,
    layerStart: 0,
    layerEnd: coordLayers - 1,
    layerCount: coordLayers,
  });
  currentLayer = coordLayers;

  // Worker layers
  for (const worker of workersAvailable) {
    if (currentLayer >= totalLayers) break;
    const workerShare = worker.available / totalRam;
    const workerLayers = Math.max(1, Math.round(totalLayers * workerShare));
    const end = Math.min(currentLayer + workerLayers - 1, totalLayers - 1);

    assignments.push({
      nodeId: worker.nodeId,
      hostname: worker.hostname,
      ip: worker.ip,
      port: worker.port,
      totalRam: worker.freeRam + workerReserve,
      freeRam: worker.freeRam,
      layerStart: currentLayer,
      layerEnd: end,
      layerCount: end - currentLayer + 1,
    });
    currentLayer = end + 1;
  }

  // If there are leftover layers, assign to coordinator
  if (currentLayer < totalLayers) {
    const last = assignments[assignments.length - 1];
    if (last.nodeId === 'coordinator') {
      last.layerEnd = totalLayers - 1;
      last.layerCount = last.layerEnd - last.layerStart + 1;
    } else {
      // Add remainder to coordinator
      assignments[0].layerEnd = totalLayers - 1;
      assignments[0].layerCount = assignments[0].layerEnd - assignments[0].layerStart + 1;
    }
  }

  return assignments;
}

/**
 * Estimate how much RAM a model needs per layer.
 */
export function ramPerLayer(model: ModelInfo): number {
  return model.estimatedSizeBytes / model.totalLayers;
}
