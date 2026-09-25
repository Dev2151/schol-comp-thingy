#  — Full Architecture

## 1. The master flow chart

_Diagram: see `docs/architecture.png`._

## 2. The two planes

The architecture is best understood as two independent networks overlaid on the same two machines.

**The coordination plane (ours, built from scratch).** This is the "who is alive, who owns what" network. It runs over TCP port 9501 and speaks a length-prefixed JSON protocol: `WORKER_HELLO` → `WORKER_WELCOME` → `ASSIGN_LAYERS` → periodic `HEARTBEAT`/`HEARTBEAT_ACK`, plus event broadcasts (`INFER_START`, `INFER_PROGRESS`, `INFER_DONE`). It carries *no model data whatsoever* — only membership, assignments, health, and free-RAM telemetry. Every 15 seconds the node reports its `MemAvailable` inside the heartbeat, which is what keeps the coordinator's model-picker fed with fresh data. On the host side this lives in `electron/tcp-server.ts` and `shared/model-selection.ts`; on the guest side in `pipeline/ttd-node.py` (which reimplements the legacy TypeScript worker's protocol byte-for-byte, in pure stdlib Python).

**The tensor plane (llama.cpp's, borrowed deliberately).** This is where actual matrix multiplications cross the wire. It is a completely separate channel from the coordination plane: `llama-server --rpc 127.0.0.1:19556` on the host talks to `ggml-rpc-server --port 9555` in the VM. During startup, the guest announces its device capabilities (CPU, free memory); the host's `ggml_backend_sched` then partitions the model's compute graph across the two backends and, at load time, ships each assigned layer's weights to its owner. At inference time, per token, hidden-state tensors are serialized over the socket, multiplied on the guest's 4 vCPUs, and shipped back. When someone asks "does the app split the model?", the precise answer is: **the app decides the split (which model, who participates), llama.cpp executes the split (which ops run where, how tensors cross).**

## 3. The components, precisely named

| Component | File / location | Port(s) | Role |
|---|---|---|---|
| Electron coordinator | `electron/main.ts`, `tcp-server.ts`, `ipc-handlers.ts` | 9501 | Cluster brain: registry, assignments, event broadcast |
| Chat UI | `renderer/src/pages/*`, served by vite | 5173 | Human interface to the coordinator |
| Model picker | `shared/model-selection.ts` | — | Reads MemAvailable from heartbeats, picks biggest fitting model, triggers pulls |
| Ollama (host + guest) | system service | 11434 | **Model warehouse only** — stores/caches GGUF, does whole-model pulls. Never splits |
| llama-server | `~/llamacpp/llama-b11191/` | 8080 (HTTP), RPC client | Tensor engine host side; `--rpc` makes it offload subgraphs |
| ggml-rpc-server | VM: `~/rpc/rpc-bin/` | 9555 | Tensor engine guest side; executes its subgraph, ships results back |
| ttd-node.py | VM: `~/ttd/ttd-node.py` | 9501 (out), 9666 (control) | Cluster membership + diagnostics; zero dependencies |
| SSH | host key → guest `authorized_keys` | 2222→22 | Command channel + optional tensor tunnel |
| QEMU | `scripts/vm-run.sh` | hostfwd 2222/9555/9666 | The "second computer," NAT'd like a real laptop |
| start-cluster.sh | `scripts/start-cluster.sh` | — | Idempotent bring-up/teardown of everything |
| ./setup | repo root | — | One-command dispatcher |

## 4. The lifecycle of one question, step by step

`./setup ask "What is 7 times 8?"`

1. **Bash** sets `LD_LIBRARY_PATH` and execs `llama-cli -m qwen25-3b.gguf --rpc 127.0.0.1:19556 -p ... -st`.
2. **RPC handshake.** llama-cli (as the server's client... precisely: llama-server or the CLI directly) connects through the SSH tunnel to the guest's rpc-server; they exchange protocol version and device descriptions ("CPU, 3910 MiB free").
3. **Graph split.** `ggml_backend_sched` assigns subgraphs to backends. With one remote and enough guest RAM, the bulk of the model — effectively all transformer blocks — lands on the VM; host keeps embeddings, final norm, and the output head.
4. **Weight shipment** (one time): assigned layers' GGUF tensors stream host → VM.
5. **Prompt pass:** tokens embed on the host → host layers compute → hidden states serialize → guest computes its blocks → returns activations → host finishes, samples token #1.
6. **Generation loop:** repeat step 5 per token until `-n` is reached. Every token crosses the wire twice (request, response). At 2.7 t/s, each round trip costs roughly 350 ms — that's the network tax, measured.
7. **stdout:** "56". Meanwhile the guest's `ttd-node.py` dashboard has been showing its assignment and heartbeating the whole time, and the coordinator (if running) logged every `INFER_PROGRESS` event.

## 5. Why this shape (the design rationale)

**Why two planes?** So neither can break the other. A crashed coordinator doesn't stop an in-flight offload generation (llama.cpp holds its own connection); a dead rpc-server doesn't confuse the cluster registry (heartbeats fail, the node reconnects independently). It also means the *hard* distributed-systems problems — split-brain, discovery, health — live in a simple JSON protocol we can debug by reading logs, while the *hard* HPC problems — tensor framing, float serialization, backpressure — live in a C++ engine upstream has hardened for years.

**Why the VM?** It's not a shortcut; it's a controlled stand-in for "a second real laptop." The VM gives us reproducibility (we can snapshot, reset, screendump-OCR it) and proves the system's only real requirements: an IP address, a TCP port, and enough RAM. On two physical PCs nothing conceptual changes — you'd pass `--rpc <their-LAN-IP>:9555` and `ttd-node.py <coordinator-IP>`. The fallback chain (explicit IP → saved IP → NAT address → mDNS) exists precisely so the same code runs in a VM, on a LAN, or over Tailscale.

**Why Ollama at all?** Convenience for the coordinator's app-side story: pull progress, model listing, caching. It is crucial to understand (and to say under questioning) that **Ollama performs zero splitting** — its scheduler never leaves the machine. The split is llama.cpp's RPC scheduler; Ollama is the warehouse where weights are kept.

**Why `ttd-node.py` replaced the Electron worker?** A node's job is to be present, honest about its resources, and diagnosable — none of which needs a GUI toolkit, a Chromium instance, or 300MB of node_modules. The terminal dashboard renders at 1 Hz with ANSI escapes; the control port answers plain text. It boots faster, uses ~20MB, and can be driven from the host with a five-line Python snippet — no agent needed.

## 6. Honest limits (the Q&A page of this document)

- **Throughput** is 2.7 t/s: the bottleneck is tensor serialization over a tunnel, not compute. Phase-2 fixes are known upstream patterns (activation compression à la Petals, direct LAN RPC without the tunnel, multiple remotes).
- **Split granularity**: with one remote, llama.cpp fills the remote first — the dashboard's "L8-25" is our assignment narrative, not ggml's ledger. `--override-tensor` can pin exact ranges when we want the story and the ledger to match.
- **The chat UI** currently generates via Ollama (whole completions); the true-offload path is the CLI. Wiring the UI to `llama-server`'s HTTP port is the obvious next milestone.
- **OOM is silent** on the guest rpc-server: if the model + KV cache exceed free RAM, the process dies with no error on the host side — it looked like a network bug until we watched RAM. Rule: guest free RAM > model size + KV + headroom.
- **Clock skew** between host and guest makes the node's `uptime_s` negative; cosmetic.
