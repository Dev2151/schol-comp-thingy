/**
 * Title TBD Ollama Stress Test & Benchmark
 * Tests AI integration with various models and prompt sizes
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';

interface BenchmarkResult {
  model: string;
  promptTokens: number;
  responseLength: number;
  totalTimeMs: number;
  tokensPerSecond: number;
}

async function checkOllamaStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json() as any;
    return (data.models || []).map((m: any) => m.name);
  } catch {
    return [];
  }
}

async function chatCompletion(model: string, prompt: string, timeoutMs = 300000): Promise<{
  content: string;
  totalDurationMs: number;
  evalCount: number;
  evalDurationMs: number;
}> {
  const start = Date.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as any;
  const totalDuration = data.total_duration ? data.total_duration / 1_000_000 : Date.now() - start;
  const evalCount = data.eval_count || 0;
  const evalDuration = data.eval_duration ? data.eval_duration / 1_000_000 : 0;

  return {
    content: data.message?.content || '',
    totalDurationMs: totalDuration,
    evalCount,
    evalDurationMs: evalDuration,
  };
}

async function benchmark(model: string, label: string, prompt: string): Promise<BenchmarkResult> {
  console.log(`  Testing: ${label}...`);
  try {
    const result = await chatCompletion(model, prompt, 120000);
    const tps = result.evalDurationMs > 0
      ? (result.evalCount / (result.evalDurationMs / 1000))
      : 0;

    const benchResult: BenchmarkResult = {
      model,
      promptTokens: Math.ceil(prompt.length / 4),
      responseLength: result.content.length,
      totalTimeMs: Math.round(result.totalDurationMs),
      tokensPerSecond: Math.round(tps),
    };

    console.log(`    ✅ ${benchResult.responseLength} chars, ${benchResult.totalTimeMs}ms, ~${benchResult.tokensPerSecond} tok/s`);
    return benchResult;
  } catch (err: any) {
    console.log(`    ❌ Error: ${err.message}`);
    return { model, promptTokens: 0, responseLength: 0, totalTimeMs: 0, tokensPerSecond: 0 };
  }
}

async function waitForModel(model: string, maxWaitMs = 120000): Promise<void> {
  console.log(`  Warming up ${model} (loading into memory)...`);
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        await res.json();
        console.log(`  ✅ Model loaded in ${Date.now() - start}ms`);
        return;
      }
    } catch {
      // Wait and retry
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Model failed to load within timeout');
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Title TBD Ollama Stress Test & Benchmark   ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // 1. Check Ollama status
  console.log('1. Checking Ollama status...');
  const running = await checkOllamaStatus();
  if (!running) {
    console.log('❌ Ollama is not running! Start it with: ollama serve');
    process.exit(1);
  }
  console.log('✅ Ollama is running\n');

  // 2. List models
  console.log('2. Available models:');
  const models = await listModels();
  if (models.length === 0) {
    console.log('❌ No models installed. Pull one with: ollama pull qwen2.5:3b');
    process.exit(1);
  }
  models.forEach(m => console.log(`   - ${m}`));
  console.log();

  const testModel = models[0];

  // Warmup - load model into memory
  console.log('3. Warming up model...');
  await waitForModel(testModel);
  console.log();

  // 4. Chat completions with varying complexity
  console.log('4. Chat Completion Tests:');

  // Simple prompt
  await chatCompletion(testModel, 'Say hello in one sentence.');
  await chatCompletion(testModel, 'What is 2+2?');
  await chatCompletion(testModel, 'Write a haiku about distributed computing.');

  // Medium prompt
  await chatCompletion(testModel, 'Explain how file chunking works in distributed storage systems. Keep it under 200 words.');

  // Long prompt
  await chatCompletion(testModel, 'Write a detailed technical explanation of how AES-256-GCM encryption works, including the initialization vector, authentication tag, and the difference between GCM and CBC modes. Include code examples in Python. Keep it under 500 words.');

  // Reasoning prompt
  await chatCompletion(testModel, 'A file is split into 5 chunks across 3 computers. If one computer goes offline permanently, can the file be recovered? What redundancy strategy would you use? Explain step by step.');

  console.log('\n5. Stress Test (rapid-fire prompts):');
  const stressPrompts = [
    'What is 1+1?',
    'Name 3 programming languages.',
    'What color is the sky?',
    'How many bytes in a kilobyte?',
    'What is TCP?',
  ];

  const startTime = Date.now();
  for (let i = 0; i < stressPrompts.length; i++) {
    const result = await chatCompletion(testModel, stressPrompts[i], 120000);
    const status = result.content.length > 0 ? '✅' : '❌';
    console.log(`  ${status} Prompt ${i + 1}: ${result.content.substring(0, 60)}...`);
  }
  const stressTime = Date.now() - startTime;
  console.log(`  Total stress test time: ${stressTime}ms (avg ${Math.round(stressTime / stressPrompts.length)}ms/prompt)\n`);

  // 5. Multi-model benchmark (if multiple models available)
  if (models.length > 1) {
    console.log('6. Multi-Model Benchmark:');
    const benchPrompt = 'Explain the CAP theorem in distributed systems in exactly 3 sentences.';
    const results: BenchmarkResult[] = [];
    for (const model of models) {
      const r = await benchmark(model, `Model: ${model}`, benchPrompt);
      results.push(r);
    }
    console.log('\n  Comparison:');
    results.sort((a, b) => b.tokensPerSecond - a.tokensPerSecond);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.model}: ~${r.tokensPerSecond} tok/s, ${r.totalTimeMs}ms`);
    });
  }

  // 6. Sequential requests test (CPU-only, can't parallelize)
  console.log('\n7. Sequential Requests Test (3 prompts):');
  const concurrentStart = Date.now();
  const seqResults = [];
  for (const p of ['List 3 colors.', 'List 3 animals.', 'List 3 countries.']) {
    const r = await chatCompletion(testModel, p, 120000);
    seqResults.push(r);
  }
  const concurrentTime = Date.now() - concurrentStart;
  console.log(`  All 3 completed in ${concurrentTime}ms`);
  seqResults.forEach((r, i) => {
    console.log(`  ${i + 1}: ${r.content.substring(0, 80)}...`);
  });

  console.log('\n═══════════════════════════════════════════════');
  console.log('✅ All Ollama tests complete!');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
