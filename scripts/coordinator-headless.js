#!/usr/bin/env node
/**
 * Headless coordinator — the cluster protocol server with zero GUI.
 * Speaks the same wire protocol as the Electron app's tcp-server.ts:
 *   4-byte BE length + JSON; WORKER_HELLO -> WELCOME -> ASSIGN_LAYERS,
 *   heartbeats, INFER_START/PROGRESS/DONE broadcast.
 */
const net = require('net');
const os = require('os');

const PORT = 9501;
const workers = new Map(); // socket -> worker info

// Model catalog for the RAM picker: [name, totalLayers, approxGB]
const CATALOG = [
  ['qwen2.5:0.5b', 28, 0.6],
  ['gemma2:2b', 26, 2.1],
  ['llama3.1:8b', 32, 5.2],
  ['gemma2:9b', 46, 6.1],
];

function send(sock, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  sock.write(Buffer.concat([len, data]));
}

function parseMessages(sock, onData) {
  let buffer = Buffer.alloc(0);
  let msgLen = 0;
  sock.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      if (msgLen === 0) {
        msgLen = buffer.readUInt32BE(0);
        buffer = buffer.subarray(4);
      }
      if (buffer.length < msgLen) break;
      const payload = buffer.subarray(0, msgLen);
      buffer = buffer.subarray(msgLen);
      msgLen = 0;
      try { onData(JSON.parse(payload.toString())); } catch {}
    }
  });
}

function log(...args) {
  console.log(new Date().toLocaleTimeString(), ...args);
}

function pickModel(minFreeGB) {
  for (const [name, layers, gb] of [...CATALOG].reverse()) {
    if (gb <= minFreeGB * 0.8) return { name, layers };
  }
  return { name: CATALOG[0][0], layers: CATALOG[0][1] };
}

function assignLayers() {
  if (workers.size === 0) return;
  const infos = [...workers.values()];
  const minFree = Math.min(
    (os.freemem() + os.totalmem() - os.totalmem() * 0.25) / 1e9, // host, rough
    ...infos.map((w) => w.freeRam / 1e9),
  );
  const { name, layers } = pickModel(minFree);
  const totalNodes = workers.size + 1;
  const perNode = Math.floor(layers / totalNodes);
  let start = 0;
  // host keeps the first slice
  const hostEnd = layers - perNode * workers.size - 1;
  log(`auto-distributing ${name}: cluster min free ~= ${minFree.toFixed(1)} GB, ${workers.size} worker(s)`);
  for (const w of infos) {
    const end = start + perNode - 1;
    send(w.sock, {
      type: 'ASSIGN_LAYERS', model: name,
      layerRange: `${start}-${end}`,
    });
    log(`assigned ${name} L${start}-${end} -> ${w.hostname}`);
    start = end + 1;
  }
}

const server = net.createServer((sock) => {
  let info = { sock, hostname: '?', freeRam: 0 };
  log('connection from', sock.remoteAddress);
  parseMessages(sock, (msg) => {
    switch (msg.type) {
      case 'WORKER_HELLO':
        info.hostname = msg.hostname || '?';
        info.freeRam = msg.freeRam || 0;
        info.totalRam = msg.totalRam || 0;
        workers.set(sock, info);
        log(`worker hello from ${info.hostname} (free ${(info.freeRam / 1e9).toFixed(1)} GB)`);
        send(sock, { type: 'WORKER_WELCOME', message: `joined as ${info.hostname}` });
        assignLayers();
        break;
      case 'HEARTBEAT_ACK':
        info.freeRam = msg.freeRam || info.freeRam;
        break;
      case 'INFER_RESPONSE':
        log(`infer response from ${info.hostname}: ${(msg.fullText || '').length} chars`);
        break;
      default:
        break;
    }
  });
  sock.on('close', () => {
    log(`worker ${info.hostname} disconnected`);
    workers.delete(sock);
  });
  sock.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  log(`headless coordinator listening on 0.0.0.0:${PORT}`);
});
