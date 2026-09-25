// ============================================================
// Title TBD — RAM-based model auto-selection
// Shared by the coordinator (electron/) so the whole cluster
// runs the biggest model that fits on EVERY connected machine.
// ============================================================

import * as os from 'os';

export interface ModelFit {
  name: string;
  minRam: number; // total RAM (bytes) needed on a machine to run this model
}

// Ordered biggest-first. minRam = usable RAM (total - OS headroom) needed.
// Calibrated against real Ollama RSS: gemma2:9b ≈ 6.5-7 GB, gemma2:2b ≈ 2.3 GB,
// qwen2.5:0.5b ≈ 1 GB.
export const MODEL_FIT_ORDER: ModelFit[] = [
  { name: 'gemma2:9b', minRam: 7 * 1024 ** 3 },
  { name: 'gemma2:2b', minRam: 2.4 * 1024 ** 3 },
  { name: 'qwen2.5:0.5b', minRam: 1 * 1024 ** 3 },
];

const OS_HEADROOM = 1.5 * 1024 ** 3; // RAM the guest/host OS itself needs

/**
 * Real usable RAM. os.freemem() reports Linux MemFree, which ignores page
 * cache and badly under-reports what's actually available — so read
 * MemAvailable from /proc/meminfo when we can.
 */
export function getEffectiveFreeRam(): number {
  try {
    const meminfo = require('fs').readFileSync('/proc/meminfo', 'utf-8');
    const m = meminfo.match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) return parseInt(m[1], 10) * 1024;
  } catch {}
  return os.freemem();
}

/**
 * Pick the biggest model that fits in the given total RAM.
 */
export function pickModelForRam(ram: number): string {
  const usable = ram - OS_HEADROOM;
  for (const m of MODEL_FIT_ORDER) {
    if (usable >= m.minRam) return m.name;
  }
  return MODEL_FIT_ORDER[MODEL_FIT_ORDER.length - 1].name;
}

/**
 * Pick the model for the whole cluster: the biggest model that fits on the
 * coordinator AND every worker (everyone must run the same model).
 */
export function pickClusterModel(
  coordinatorFreeRam: number,
  workers: { freeRam: number }[]
): string {
  // Coordinator keeps 4GB for itself + OS (tuned for a 16GB laptop that also
  // hosts the worker VM; the original 6GB reserve was for gemma2:9b-only demos)
  const coordUsable = Math.max(0, coordinatorFreeRam - 4 * 1024 ** 3);
  let pick = pickModelForRam(coordUsable + OS_HEADROOM);
  for (const w of workers) {
    const workerPick = pickModelForRam(Math.max(0, w.freeRam - 1 * 1024 ** 3) + OS_HEADROOM);
    if (modelRank(workerPick) < modelRank(pick)) pick = workerPick;
  }
  return pick;
}

function modelRank(name: string): number {
  const i = MODEL_FIT_ORDER.findIndex(m => name.startsWith(m.name.split(':')[0]));
  return i === -1 ? MODEL_FIT_ORDER.length : i;
}

/**
 * Make sure Ollama has the model, pulling it if missing.
 * onLog receives human-readable progress lines.
 */
export async function ensureOllamaModel(
  model: string,
  onLog?: (msg: string) => void
): Promise<boolean> {
  const log = onLog || (() => {});
  try {
    const tags = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (tags.ok) {
      const data: any = await tags.json();
      const installed = (data.models || []).some(
        (m: any) => m.name === model || m.name === `${model}:latest`
      );
      if (installed) return true;
    }
  } catch {
    log(`Ollama is not reachable — cannot check/pull ${model} (is 'ollama serve' running?)`);
    return false;
  }

  log(`Model ${model} not installed — pulling it now (one-time download, this can take a while)...`);
  try {
    const res = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
    if (!res.ok || !res.body) {
      log(`Ollama pull failed with HTTP ${res.status}`);
      return false;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lastLine = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n').filter(l => l.trim())) {
        try {
          const j = JSON.parse(line);
          if (j.error) {
            log(`Ollama pull error: ${j.error}`);
            return false;
          }
          if (j.status) {
            const pct = j.total ? `${Math.round(((j.completed || 0) / j.total) * 100)}%` : '';
            const text = `${j.status}${pct ? ' ' + pct : ''}`;
            if (text !== lastLine) {
              lastLine = text;
              log(`[ollama] ${text}`);
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    }
    log(`Model ${model} is ready.`);
    return true;
  } catch (err: any) {
    log(`Ollama pull failed: ${err.message}`);
    return false;
  }
}
