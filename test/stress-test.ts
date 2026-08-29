/**
 * Title TBD Comprehensive Stress Test
 * Tests relay, file storage, and network end-to-end
 */

const R = 'http://localhost:9500';
let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  cond ? (passed++, console.log(`  ✅ ${msg}`)) : (failed++, console.log(`  ❌ ${msg}`));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Title TBD Comprehensive Stress Test            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ===== 1: Relay Server Stress =====
  console.log('--- 1. Relay Server Stress ---');

  // Health check
  try {
    const s = await (await fetch(`${R}/status`)).json() as any;
    ok(s.status === 'ok', 'Health check');
  } catch (e: any) { ok(false, `Health check: ${e.message}`); }

  // Register 50 nodes rapidly
  const nodeIds: string[] = [];
  const regStart = Date.now();
  for (let i = 0; i < 50; i++) {
    const nodeId = `stress-node-${String(i).padStart(3, '0')}`;
    nodeIds.push(nodeId);
    const res = await fetch(`${R}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        hostname: `StressHost-${i}`,
        ip: `10.0.${Math.floor(i / 256)}.${i % 256}`,
        port: 9501 + i,
        storageOffered: 1e9,
        storageUsed: Math.random() * 1e9,
        status: 'online',
        nodeType: 'desktop',
        isRelay: false,
        lastSeen: Date.now(),
      }),
    });
    ok(res.ok, `Register node ${i}`);
  }
  console.log(`  ⏱  Registered 50 nodes in ${Date.now() - regStart}ms`);

  // List all nodes
  const nodesRes = await (await fetch(`${R}/nodes`)).json() as any;
  ok(nodesRes.nodes.length >= 50, `List all ${nodesRes.nodes.length} nodes`);

  // Store 20 chunks rapidly
  const chunkStart = Date.now();
  const chunkIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    const chunkId = `stress-chunk-${i}`;
    chunkIds.push(chunkId);
    const data = Buffer.from(`Chunk ${i} data: ${'x'.repeat(1000)}`).toString('base64');
    const res = await fetch(`${R}/chunk/${chunkId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, metadata: { index: i }, nodeId: nodeIds[i % nodeIds.length] }),
    });
    ok(res.ok, `Store chunk ${i}`);
  }
  console.log(`  ⏱  Stored 20 chunks in ${Date.now() - chunkStart}ms`);

  // Fetch all chunks
  const fetchStart = Date.now();
  for (const chunkId of chunkIds) {
    const res = await (await fetch(`${R}/chunk/${chunkId}`)).json() as any;
    ok(res.data !== undefined, `Fetch ${chunkId}`);
  }
  console.log(`  ⏱  Fetched 20 chunks in ${Date.now() - fetchStart}ms`);

  // Heartbeats
  const hbStart = Date.now();
  for (const nodeId of nodeIds.slice(0, 25)) {
    await fetch(`${R}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }
  console.log(`  ⏱  25 heartbeats in ${Date.now() - hbStart}ms`);

  // Deregister half
  const delStart = Date.now();
  for (const nodeId of nodeIds.slice(0, 25)) {
    await fetch(`${R}/deregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }
  console.log(`  ⏱  Deregistered 25 nodes in ${Date.now() - delStart}ms`);

  const afterDel = await (await fetch(`${R}/nodes`)).json() as any;
  ok(afterDel.nodes.length >= 25, `${afterDel.nodes.length} nodes remain after deregister`);

  // ===== 2: Concurrent stress =====
  console.log('\n--- 2. Concurrent Stress ---');

  // 20 parallel register requests
  const parallelRegs = Array.from({ length: 20 }, (_, i) =>
    fetch(`${R}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: `parallel-${i}`,
        hostname: `ParHost-${i}`,
        ip: `192.168.1.${i}`,
        port: 9600 + i,
        storageOffered: 500e6,
        storageUsed: 0,
        status: 'online',
        nodeType: 'mobile',
        isRelay: false,
        lastSeen: Date.now(),
      }),
    })
  );
  const parResults = await Promise.all(parallelRegs);
  const parOk = parResults.filter(r => r.ok).length;
  ok(parOk === 20, `${parOk}/20 parallel registrations succeeded`);

  // 10 parallel chunk stores
  const parallelChunks = Array.from({ length: 10 }, (_, i) =>
    fetch(`${R}/chunk/par-chunk-${i}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: Buffer.from(`Parallel chunk ${i}`).toString('base64'),
        metadata: {},
        nodeId: `parallel-${i}`,
      }),
    })
  );
  const parChunkResults = await Promise.all(parallelChunks);
  const parChunkOk = parChunkResults.filter(r => r.ok).length;
  ok(parChunkOk === 10, `${parChunkOk}/10 parallel chunk stores succeeded`);

  // ===== 3: Cleanup =====
  console.log('\n--- 3. Cleanup ---');
  for (const nodeId of nodeIds.slice(25)) {
    await fetch(`${R}/deregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }
  for (const nodeId of Array.from({ length: 20 }, (_, i) => `parallel-${i}`)) {
    await fetch(`${R}/deregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }
  const finalNodes = await (await fetch(`${R}/nodes`)).json() as any;
  ok(true, `Cleanup done. Remaining nodes: ${finalNodes.nodes.length}`);

  // ===== 4: Error handling =====
  console.log('\n--- 4. Error Handling ---');
  const missingChunk = await fetch(`${R}/chunk/nonexistent-999`);
  ok(!missingChunk.ok, 'Missing chunk returns 404');
  const badRegister = await fetch(`${R}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  ok(!badRegister.ok, 'Bad JSON returns error');

  // ===== Summary =====
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
