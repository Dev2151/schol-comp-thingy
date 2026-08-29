import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const CHUNKER = require('../electron/storage/chunker');
const ENCRYPTOR = require('../electron/storage/encryptor');
const MANIFEST = require('../electron/storage/manifest');

const DATA_DIR = '/tmp/freegrid-test-data';
let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) { cond ? (passed++, console.log(`  ✅ ${msg}`)) : (failed++, console.log(`  ❌ ${msg}`)); }
function eq(a: any, b: any, msg: string) { ok(a === b, `${msg} (got ${a}, expected ${b})`); }
function bufEq(a: Buffer, b: Buffer, msg: string) { ok(a.equals(b), msg); }
function section(name: string) { console.log(`\n--- ${name} ---`); }

async function main() {
  // Clean
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ===== 1: Chunking =====
  section('Chunking');
  const data3m = crypto.randomBytes(3 * 1024 * 1024);
  const chunks = CHUNKER.splitIntoChunks(data3m, 1024 * 1024);
  eq(chunks.length, 3, '3MB → 3 chunks');
  bufEq(CHUNKER.reassembleChunks(chunks), data3m, 'Roundtrip reassembly');

  const tiny = Buffer.from('hello');
  const tc = CHUNKER.splitIntoChunks(tiny, 1024 * 1024);
  eq(tc.length, 1, 'Tiny file → 1 chunk');
  bufEq(CHUNKER.reassembleChunks(tc), tiny, 'Tiny roundtrip');

  // ===== 2: Hashing =====
  section('Hashing');
  const h1 = CHUNKER.computeHash(Buffer.from('abc'));
  const h2 = CHUNKER.computeHash(Buffer.from('abc'));
  eq(h1, h2, 'Same input → same hash');
  ok(h1 !== CHUNKER.computeHash(Buffer.from('xyz')), 'Different input → different hash');
  ok(CHUNKER.verifyHash(Buffer.from('abc'), h1), 'verifyHash correct');
  ok(!CHUNKER.verifyHash(Buffer.from('abc'), h2 + 'x'), 'verifyHash wrong hash');

  // ===== 3: Encryption =====
  section('Encryption');
  const password = 'test-pass-123';
  const salt = ENCRYPTOR.generateSalt();
  const key = ENCRYPTOR.deriveKey(password, salt);
  const plain = Buffer.from('Secret data!');
  const enc = ENCRYPTOR.encrypt(plain, key);
  ok(enc.iv.length === 16, 'IV is 16 bytes');
  ok(!enc.encryptedData.equals(plain), 'Encrypted ≠ plaintext');
  const dec = ENCRYPTOR.decrypt(enc.encryptedData, key, enc.iv, enc.authTag);
  bufEq(dec, plain, 'Decrypt matches original');

  const packed = ENCRYPTOR.encryptToBuffer(plain, key);
  const unpacked = ENCRYPTOR.decryptFromBuffer(packed, key);
  bufEq(unpacked, plain, 'Packed roundtrip');

  const wrongKey = ENCRYPTOR.deriveKey('wrong', salt);
  let threw = false;
  try { ENCRYPTOR.decryptFromBuffer(packed, wrongKey); } catch { threw = true; }
  ok(threw, 'Wrong password throws');

  // ===== 4: Manifest =====
  section('Manifest');
  const { manifest: m1, fileId: fid1, salt: mSalt } = MANIFEST.createManifest('test.txt', 'text/plain', 2048);
  eq(m1.totalChunks, 2, '2048 bytes → 2 chunks at 1024');
  MANIFEST.saveManifest(DATA_DIR, m1);
  const loaded = MANIFEST.loadManifest(DATA_DIR, fid1);
  ok(loaded !== null, 'Save/load manifest');
  eq(loaded.chunks.length, 0, 'Empty chunks list');
  const all = MANIFEST.listManifests(DATA_DIR);
  eq(all.length, 1, 'List manifests');
  ok(MANIFEST.deleteManifest(DATA_DIR, fid1), 'Delete manifest');
  eq(MANIFEST.listManifests(DATA_DIR).length, 0, 'Empty after delete');

  // ===== 5: Full Roundtrip =====
  section('Full Roundtrip');
  const origData = fs.readFileSync('/tmp/freegrid-test/medium.bin');
  const { manifest: m2, fileId: fid2, salt: s2 } = MANIFEST.createManifest('medium.bin', 'application/octet-stream', origData.length);
  const fileChunks = CHUNKER.splitIntoChunks(origData, m2.chunkSize);
  ok(fileChunks.length > 1, `${origData.length} bytes → ${fileChunks.length} chunks`);

  for (const c of fileChunks) {
    const ck = ENCRYPTOR.deriveKey('rt-pass', s2);
    const ed = ENCRYPTOR.encryptToBuffer(c.data, ck);
    const { hash } = MANIFEST.storeChunkLocally(DATA_DIR, fid2, c.index, ed, 'rt-pass');
    MANIFEST.addChunkToManifest(m2, {
      chunkId: crypto.randomUUID(), fileId: fid2, chunkIndex: c.index,
      totalChunks: fileChunks.length, originalSize: c.size, encryptedSize: ed.length,
      sha256: hash, iv: '', nodeId: 'local',
    });
  }
  MANIFEST.saveManifest(DATA_DIR, m2);

  const lm = MANIFEST.loadManifest(DATA_DIR, fid2);
  eq(lm.chunks.length, fileChunks.length, 'Stored all chunks');
  const roundTripChunks: any[] = [];
  for (const cm of lm.chunks) {
    const fp = path.join(DATA_DIR, 'freegrid-storage', 'chunks', fid2, `chunk_${String(cm.chunkIndex).padStart(4, '0')}.enc`);
    ok(fs.existsSync(fp), `Chunk file ${cm.chunkIndex} exists`);
    const ed = fs.readFileSync(fp);
    const ck = ENCRYPTOR.deriveKey('rt-pass', s2);
    const d = ENCRYPTOR.decryptFromBuffer(ed, ck);
    roundTripChunks.push({ index: cm.chunkIndex, data: d, size: d.length });
  }
  bufEq(CHUNKER.reassembleChunks(roundTripChunks), origData, 'Full roundtrip matches original');

  // ===== 6: Relay Server =====
  section('Relay Server');
  const R = 'http://localhost:9500';
  try {
    const s = await (await fetch(`${R}/status`)).json() as any;
    ok(s.status === 'ok', 'Health check');
    ok(typeof s.uptime === 'number', 'Uptime reported');

    const node = { nodeId: 'test-001', hostname: 'Test', ip: '10.0.0.1', port: 9501, storageOffered: 1e9, storageUsed: 0, status: 'online', nodeType: 'desktop' as const, isRelay: false, lastSeen: Date.now() };
    ok((await fetch(`${R}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(node) })).ok, 'Register node');

    const nodes = await (await fetch(`${R}/nodes`)).json() as any;
    ok(nodes.nodes.length >= 1, 'List nodes');

    const chunkData = Buffer.from('relay test').toString('base64');
    ok((await fetch(`${R}/chunk/c-001`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: chunkData, metadata: {}, nodeId: 'test-001' }) })).ok, 'Store chunk');

    const fetched = await (await fetch(`${R}/chunk/c-001`)).json() as any;
    eq(fetched.data, chunkData, 'Fetch chunk matches');

    ok((await fetch(`${R}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: 'test-001' }) })).ok, 'Heartbeat');
    ok((await fetch(`${R}/deregister`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: 'test-001' }) })).ok, 'Deregister');
  } catch (e: any) { ok(false, `Relay: ${e.message}`); }

  // ===== 7: Stress Test =====
  section('Stress Test (5 files)');
  const stressFiles = [
    { name: 'tiny.txt', size: 10 },
    { name: 'small.txt', size: 100 },
    { name: 'med.txt', size: 10000 },
    { name: 'big.txt', size: 1000000 },
    { name: 'huge.txt', size: 5000000 },
  ];
  const stressDir = '/tmp/freegrid-stress';
  if (fs.existsSync(stressDir)) fs.rmSync(stressDir, { recursive: true });
  fs.mkdirSync(stressDir, { recursive: true });

  const stressStart = Date.now();
  let allOk = true;
  for (const sf of stressFiles) {
    const data = crypto.randomBytes(sf.size);
    const { manifest: sm, fileId: sfid, salt: ss } = MANIFEST.createManifest(sf.name, 'application/octet-stream', data.length);
    const sc = CHUNKER.splitIntoChunks(data, sm.chunkSize);
    for (const c of sc) {
      const k = ENCRYPTOR.deriveKey('stress', ss);
      const ed = ENCRYPTOR.encryptToBuffer(c.data, k);
      const { hash } = MANIFEST.storeChunkLocally(stressDir, sfid, c.index, ed, 'stress');
      MANIFEST.addChunkToManifest(sm, { chunkId: crypto.randomUUID(), fileId: sfid, chunkIndex: c.index, totalChunks: sc.length, originalSize: c.size, encryptedSize: ed.length, sha256: hash, iv: '', nodeId: 'local' });
    }
    MANIFEST.saveManifest(stressDir, sm);

    const lm2 = MANIFEST.loadManifest(stressDir, sfid);
    const rc: any[] = [];
    for (const cm of lm2.chunks) {
      const fp = path.join(stressDir, 'freegrid-storage', 'chunks', sfid, `chunk_${String(cm.chunkIndex).padStart(4, '0')}.enc`);
      const ed = fs.readFileSync(fp);
      const k = ENCRYPTOR.deriveKey('stress', ss);
      rc.push({ index: cm.chunkIndex, data: ENCRYPTOR.decryptFromBuffer(ed, k), size: 0 });
    }
    if (!CHUNKER.reassembleChunks(rc).equals(data)) { allOk = false; ok(false, `${sf.name} roundtrip`); }
  }
  ok(allOk, `All 5 stress files OK (${Date.now() - stressStart}ms)`);

  // ===== 8: Benchmarks =====
  section('Benchmarks');
  const benchData = crypto.randomBytes(10 * 1024 * 1024);

  let t = Date.now();
  const bc = CHUNKER.splitIntoChunks(benchData, 1024 * 1024);
  console.log(`  📊 Chunk 10MB: ${Date.now() - t}ms`);

  const bk = ENCRYPTOR.deriveKey('bench', ENCRYPTOR.generateSalt());
  t = Date.now();
  for (const c of bc) ENCRYPTOR.encryptToBuffer(c.data, bk);
  console.log(`  📊 Encrypt 10MB: ${Date.now() - t}ms`);

  const bec = bc.map((c: any) => ENCRYPTOR.encryptToBuffer(c.data, bk));
  t = Date.now();
  for (const e of bec) ENCRYPTOR.decryptFromBuffer(e, bk);
  console.log(`  📊 Decrypt 10MB: ${Date.now() - t}ms`);

  t = Date.now();
  for (const c of bc) CHUNKER.computeHash(c.data);
  console.log(`  📊 Hash 10MB: ${Date.now() - t}ms`);

  t = Date.now();
  const pc = CHUNKER.splitIntoChunks(benchData, 1024 * 1024);
  for (const c of pc) { const e = ENCRYPTOR.encryptToBuffer(c.data, bk); CHUNKER.computeHash(e); }
  const pipelineMs = Date.now() - t;
  console.log(`  📊 Pipeline (split+encrypt+hash) 10MB: ${pipelineMs}ms (${(10000 / pipelineMs).toFixed(1)} MB/s)`);

  // ===== Summary =====
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
