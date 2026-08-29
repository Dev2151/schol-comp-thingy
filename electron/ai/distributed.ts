// ============================================================
// FreeGrid — Distributed Inference Engine
// Coordinator runs inference, worker sees live progress
// ============================================================

import * as os from 'os';
import { calculateLayerSplit, getModelInfo, NodeAssignment, ModelInfo } from './pipeline';

let currentAssignments: NodeAssignment[] = [];
let currentModel: ModelInfo | null = null;
let activeController: AbortController | null = null;

export function getPipelineState() {
  return {
    model: currentModel,
    assignments: currentAssignments,
    activeWorkers: currentAssignments.filter(a => a.nodeId !== 'coordinator'),
    coordinatorLayers: currentAssignments.find(a => a.nodeId === 'coordinator') || null,
    workerLayers: currentAssignments.filter(a => a.nodeId !== 'coordinator'),
  };
}

export function assignLayers(
  modelName: string,
  coordinatorFreeRam: number,
  workers: { nodeId: string; hostname: string; ip: string; port: number; freeRam: number }[]
): NodeAssignment[] {
  const model = getModelInfo(modelName);
  if (!model) {
    currentModel = { name: modelName, totalLayers: 26, estimatedSizeBytes: 1.6 * 1024**3, paramsBillions: 2.6 };
  } else {
    currentModel = model;
  }
  currentAssignments = calculateLayerSplit(currentModel, coordinatorFreeRam, workers);
  console.log(`[Pipeline] Split ${currentModel.name}: ${currentAssignments.map(a => `${a.hostname} L${a.layerStart}-${a.layerEnd}`).join(' | ')}`);
  return currentAssignments;
}

export function sendLayerAssignment(nodeId: string, assignment: NodeAssignment): boolean {
  const { getWorkerSocket } = require('../network/tcp-server');
  const socket = getWorkerSocket(nodeId);
  if (!socket) {
    console.log(`[Pipeline] No socket for ${nodeId.slice(0, 8)} — cannot assign layers`);
    return false;
  }
  const msg = JSON.stringify({
    type: 'ASSIGN_LAYERS',
    model: currentModel?.name || 'unknown',
    layerRange: `${assignment.layerStart}-${assignment.layerEnd}`,
    layerStart: assignment.layerStart,
    layerEnd: assignment.layerEnd,
    totalLayers: currentModel?.totalLayers || 0,
  });
  const buf = Buffer.from(msg);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  socket.write(Buffer.concat([len, buf]));
  console.log(`[Pipeline] Assigned L${assignment.layerStart}-${assignment.layerEnd} of ${currentModel?.name} to ${assignment.hostname}`);
  return true;
}

/**
 * Broadcast a token to all connected workers so they show activity
 */
function broadcastTokenToWorkers(token: string, tokenIndex: number, totalTokens: number) {
  const { getAllWorkerSockets } = require('../network/tcp-server');
  const sockets = getAllWorkerSockets();
  for (const [nodeId, socket] of sockets) {
    try {
      const msg = JSON.stringify({
        type: 'INFER_PROGRESS',
        token,
        tokenIndex,
        totalTokens,
        model: currentModel?.name || 'unknown',
      });
      const buf = Buffer.from(msg);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(buf.length, 0);
      socket.write(Buffer.concat([len, buf]));
    } catch (err) {
      // Socket may have closed — that's fine
    }
  }
}

function broadcastInferenceStart(modelName: string, prompt: string) {
  const { getAllWorkerSockets } = require('../network/tcp-server');
  const sockets = getAllWorkerSockets();
  for (const [nodeId, socket] of sockets) {
    try {
      const msg = JSON.stringify({
        type: 'INFER_START',
        model: modelName,
        prompt: prompt.slice(0, 200),
      });
      const buf = Buffer.from(msg);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(buf.length, 0);
      socket.write(Buffer.concat([len, buf]));
    } catch {}
  }
}

function broadcastInferenceDone(fullText: string) {
  const { getAllWorkerSockets } = require('../network/tcp-server');
  const sockets = getAllWorkerSockets();
  for (const [nodeId, socket] of sockets) {
    try {
      const msg = JSON.stringify({
        type: 'INFER_DONE',
        fullText: fullText.slice(0, 500),
      });
      const buf = Buffer.from(msg);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(buf.length, 0);
      socket.write(Buffer.concat([len, buf]));
    } catch {}
  }
}

function broadcastInferStop() {
  const { getAllWorkerSockets } = require('../network/tcp-server');
  const sockets = getAllWorkerSockets();
  for (const [nodeId, socket] of sockets) {
    try {
      const msg = JSON.stringify({ type: 'INFER_STOP' });
      const buf = Buffer.from(msg);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(buf.length, 0);
      socket.write(Buffer.concat([len, buf]));
      console.log(`[Pipeline] Sent INFER_STOP to worker ${nodeId.slice(0, 8)}`);
    } catch {}
  }
}

/**
 * Run distributed inference:
 * - Coordinator runs Ollama inference
 * - Streams tokens to chat UI
 * - Broadcasts token progress to worker via TCP so it shows live activity
 */
export function runDistributedInference(
  prompt: string,
  model: string,
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
): AbortController {
  const controller = new AbortController();
  activeController = controller;

  const workers = currentAssignments.filter(a => a.nodeId !== 'coordinator');
  const hasWorkers = workers.length > 0;

  console.log(`[Pipeline] Starting inference: model=${model}, workers=${workers.length}`);

  // Notify workers that inference is starting
  if (hasWorkers) {
    broadcastInferenceStart(model, prompt);
  }

  const { getOllamaClient } = require('./ollama-client');
  const client = getOllamaClient();

  let fullText = '';
  let tokenIndex = 0;

  client.chatStream(
    model,
    prompt,
    [],
    (token: string) => {
      if (controller.signal.aborted) return;
      tokenIndex++;
      fullText += token;
      onToken(token);

      // Broadcast each token to workers so they show live activity
      if (hasWorkers) {
        broadcastTokenToWorkers(token, tokenIndex, -1);
      }
    },
    (result: string) => {
      console.log(`[Pipeline] Inference complete: ${result.length} chars, ${tokenIndex} tokens`);
      if (hasWorkers) {
        broadcastInferenceDone(result);
      }
      activeController = null;
      onDone(result);
    },
    (error: string) => {
      console.error(`[Pipeline] Inference error: ${error}`);
      activeController = null;
      onError(error);
    },
  );

  return controller;
}

export function onWorkerInferResponse(tokens: string[], fullText: string, nodeId?: string) {
  // Not used in current simplified flow — workers receive progress, not send inference
  console.log(`[Pipeline] Unexpected worker response from ${nodeId}: ignored`);
}

export function stopInference() {
  if (activeController) {
    activeController.abort();
    activeController = null;
    console.log(`[Pipeline] Inference stopped`);
  }
  // Tell all workers to stop too
  broadcastInferStop();
}

export function cleanup() {
  stopInference();
  currentAssignments = [];
  currentModel = null;
}
